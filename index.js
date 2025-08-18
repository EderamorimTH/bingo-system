const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configurar EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Configurar Mongoose
mongoose.set('strictQuery', true);

// Schemas
const gameSchema = new mongoose.Schema({
  drawnNumbers: [Number],
  lastNumber: Number,
  currentPrize: String,
  startMessage: String
});
const Game = mongoose.model('Game', gameSchema);

const cartelaSchema = new mongoose.Schema({
  cartelaId: String,
  numbers: [[Number]],
  playerName: String,
  markedNumbers: [Number],
  createdAt: Date
});
const Cartela = mongoose.model('Cartela', cartelaSchema);

const playerSchema = new mongoose.Schema({
  playerName: String,
  phoneNumber: String,
  link: String,
  createdAt: Date
});
const Player = mongoose.model('Player', playerSchema);

const winnerSchema = new mongoose.Schema({
  cartelaId: String,
  playerName: String,
  phoneNumber: String,
  link: String,
  createdAt: Date
});
const Winner = mongoose.model('Winner', winnerSchema);

// Conexão com MongoDB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Conectado ao MongoDB');
    const game = await Game.findOne();
    if (!game) {
      await new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', startMessage: 'Em breve o Bingo irá começar' }).save();
    }

    // gerar 500 cartelas fixas se não existirem
    const totalCartelas = await Cartela.countDocuments({ playerName: "FIXAS" });
    if (totalCartelas < 500) {
      console.log("Gerando 500 cartelas fixas...");
      await Cartela.deleteMany({ playerName: "FIXAS" });
      for (let i = 1; i <= 500; i++) {
        const numbers = generateCartelaNumbers();
        await new Cartela({
          cartelaId: `FIXA-${i}`,
          numbers,
          playerName: "FIXAS",
          markedNumbers: [],
          createdAt: new Date()
        }).save();
      }
      console.log("500 cartelas fixas geradas");
    }
  })
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// Middleware auth
function isAuthenticated(req, res, next) {
  if (req.cookies.auth === 'true') return next();
  res.redirect('/login');
}

// Função para gerar cartela
function generateCartelaNumbers() {
  const numbers = [];
  const ranges = [
    { min: 1, max: 15 },
    { min: 16, max: 30 },
    { min: 31, max: 45 },
    { min: 46, max: 60 },
    { min: 61, max: 75 }
  ];
  for (let col = 0; col < 5; col++) {
    const column = [];
    const { min, max } = ranges[col];
    const available = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    for (let row = 0; row < 5; row++) {
      if (col === 2 && row === 2) {
        column.push(0);
      } else {
        const index = Math.floor(Math.random() * available.length);
        column.push(available.splice(index, 1)[0]);
      }
    }
    numbers.push(column);
  }
  return numbers;
}

// Rotas
app.get('/', (req, res) => res.redirect('/display'));

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.cookie('auth', 'true', { httpOnly: true });
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Senha incorreta' });
  }
});

app.get('/admin', isAuthenticated, async (req, res) => {
  const players = await Player.find().sort({ createdAt: -1 });
  const winners = await Winner.find().sort({ createdAt: -1 });
  const game = await Game.findOne();
  res.render('admin', { players, winners, game });
});

app.get('/display', async (req, res) => res.render('display'));

app.get('/sorteador', async (req, res) => {
  const game = await Game.findOne();
  const winners = await Winner.find().sort({ createdAt: -1 });
  res.render('sorteador', { game, winners });
});

app.get('/cartelas', async (req, res) => {
  const { playerName } = req.query;
  if (!playerName) return res.status(400).send('Nome do jogador é obrigatório');
  const cartelas = await Cartela.find({ playerName });
  if (cartelas.length === 0) return res.status(404).send('Nenhuma cartela encontrada');
  const game = await Game.findOne();
  const winnerIds = (await Winner.find()).map(w => w.cartelaId);
  res.render('cartelas', { cartelas, playerName, game, winners: winnerIds });
});

app.get('/cartelas-fixas', async (req, res) => {
  const cartelas = await Cartela.find({ playerName: "FIXAS" });
  const game = await Game.findOne();
  res.render('cartelas', { cartelas, playerName: "Cartelas Fixas", game, winners: [] });
});

// Reset sem apagar cartelas
app.post('/reset', isAuthenticated, async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
  await Game.deleteMany({});
  await Winner.deleteMany({});
  const cartelas = await Cartela.find();
  for (const c of cartelas) {
    c.markedNumbers = [];
    await c.save();
  }
  await new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', startMessage: 'Em breve o Bingo irá começar' }).save();
  res.json({ success: true });
});

// WebSocket
wss.on('connection', ws => {
  Game.findOne().then(game => {
    ws.send(JSON.stringify({ type: 'update', game, winners: [] }));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
