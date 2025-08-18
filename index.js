const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');
require('dotenv').config();

const app = express();

// ===== CONFIGURAÇÕES =====
const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';
const MONGODB_URI = process.env.MONGODB_URI;

// ===== MONGODB =====
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Conectado ao MongoDB'))
  .catch(err => console.error('Erro ao conectar MongoDB:', err));

// ===== MODELOS =====
const cartelaSchema = new mongoose.Schema({
  cartelaId: Number,
  numeros: [Number],
  dono: String,
  telefone: String,
  link: String
});
const Cartela = mongoose.model('Cartela', cartelaSchema);

const gameSchema = new mongoose.Schema({
  drawnNumbers: [Number],
  lastNumber: Number,
  currentPrize: String
});
const Game = mongoose.model('Game', gameSchema);

const winnerSchema = new mongoose.Schema({
  playerName: String,
  phoneNumber: String,
  cartelaId: Number,
  prize: String,
  link: String
});
const Winner = mongoose.model('Winner', winnerSchema);

// ===== MIDDLEWARE =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(session({ secret: 'bingo-secret', resave: false, saveUninitialized: false }));

// ===== AUTENTICAÇÃO =====
function isAuthenticated(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
}

app.get('/login', (req, res) => {
  res.send(`
    <form method="post" action="/login">
      <input type="password" name="password" placeholder="Senha"/>
      <button type="submit">Entrar</button>
    </form>
  `);
});

app.post('/login', bodyParser.urlencoded({ extended: true }), (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/admin');
  } else {
    res.send('Senha incorreta');
  }
});

// ===== ROTAS PRINCIPAIS =====
app.get('/admin', isAuthenticated, async (req, res) => {
  const game = await Game.findOne() || {};
  const winners = await Winner.find();
  res.render('admin', { game, winners, error: null });
});

app.get('/display', async (req, res) => {
  const game = await Game.findOne() || {};
  res.render('display', { game });
});

app.get('/sorteador', async (req, res) => {
  const game = await Game.findOne() || {};
  res.render('sorteador', { game });
});

app.get('/cartelas-fixas', async (req, res) => {
  const cartelas = await Cartela.find();
  res.render('cartelas', { cartelas });
});

// ===== ENDPOINTS =====
app.post('/assign-cartelas', async (req, res) => {
  const { cartelaNumbers, playerName, phoneNumber } = req.body;
  if (!cartelaNumbers || !playerName) {
    return res.json({ error: 'Dados inválidos' });
  }

  const numbers = cartelaNumbers.split(',').map(n => parseInt(n.trim()));
  for (let id of numbers) {
    const existente = await Cartela.findOne({ cartelaId: id, dono: { $ne: null } });
    if (existente) {
      return res.json({ error: `Cartela ${id} já atribuída para ${existente.dono}` });
    }
  }

  for (let id of numbers) {
    const link = `${req.protocol}://${req.get('host')}/cartelas?playerName=${encodeURIComponent(playerName)}`;
    await Cartela.updateOne(
      { cartelaId: id },
      { dono: playerName, telefone: phoneNumber, link },
      { upsert: true }
    );
  }

  res.json({ success: true });
});

app.post('/update-prize', async (req, res) => {
  let game = await Game.findOne();
  if (!game) game = new Game();
  game.currentPrize = req.body.currentPrize;
  await game.save();
  broadcast({ type: 'update', game });
  res.json({ success: true });
});

app.post('/draw', async (req, res) => {
  let game = await Game.findOne();
  if (!game) game = new Game({ drawnNumbers: [] });

  let numero;
  do {
    numero = Math.floor(Math.random() * 75) + 1;
  } while (game.drawnNumbers.includes(numero));

  game.drawnNumbers.push(numero);
  game.lastNumber = numero;
  await game.save();

  broadcast({ type: 'update', game });
  res.json({ numero });
});

app.post('/mark-number', async (req, res) => {
  const { number, password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.json({ error: 'Senha incorreta' });

  let game = await Game.findOne();
  if (!game) game = new Game({ drawnNumbers: [] });

  if (!game.drawnNumbers.includes(number)) {
    game.drawnNumbers.push(number);
    game.lastNumber = number;
    await game.save();
    broadcast({ type: 'update', game });
  }
  res.json({ success: true });
});

app.post('/reset', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.json({ error: 'Senha incorreta' });

  await Game.deleteMany({});
  await Winner.deleteMany({});
  broadcast({ type: 'update', game: {} });
  res.json({ success: true });
});

// ===== WEBSOCKET =====
const server = app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
const wss = new WebSocketServer({ server });

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify(data));
  });
}
