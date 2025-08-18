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

// Função para broadcast
function broadcast(game, winners) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game, winners }));
    }
  });
}

// Função checkWin
function checkWin(cartela) {
  const marked = cartela.markedNumbers;
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      const num = cartela.numbers[col][row];
      if (num !== 0 && !marked.includes(num)) {
        return false;
      }
    }
  }
  return true;
}

// Função drawNumber
async function drawNumber() {
  const game = await Game.findOne();
  const available = Array.from({length: 75}, (_, i) => i+1).filter(n => !game.drawnNumbers.includes(n));
  if (!available.length) return { error: 'Não há mais números para sortear' };
  const newNumber = available[Math.floor(Math.random() * available.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();
  const cartelas = await Cartela.find();
  const winners = [];
  const existingWinner = await Winner.findOne();
  if (!existingWinner) {
    for (const cartela of cartelas) {
      if (cartela.playerName === "FIXAS") continue;
      if (cartela.numbers.flat().includes(newNumber)) {
        cartela.markedNumbers.push(newNumber);
        if (checkWin(cartela)) {
          const player = await Player.findOne({ playerName: cartela.playerName });
          await new Winner({
            cartelaId: cartela.cartelaId,
            playerName: cartela.playerName,
            phoneNumber: player ? player.phoneNumber : '',
            link: player ? player.link : '',
            createdAt: new Date()
          }).save();
          winners.push(cartela.cartelaId);
          await cartela.save();
          break;
        }
        await cartela.save();
      }
    }
  }
  return { newNumber, winners };
}

// Função markNumber
async function markNumber(number) {
  number = parseInt(number);
  if (!Number.isInteger(number) || number < 1 || number > 75) return { error: 'Número inválido' };
  const game = await Game.findOne();
  if (game.drawnNumbers.includes(number)) return { error: 'Número já sorteado' };
  game.drawnNumbers.push(number);
  game.lastNumber = number;
  await game.save();
  const cartelas = await Cartela.find();
  const winners = [];
  const existingWinner = await Winner.findOne();
  if (!existingWinner) {
    for (const cartela of cartelas) {
      if (cartela.playerName === "FIXAS") continue;
      if (cartela.numbers.flat().includes(number)) {
        cartela.markedNumbers.push(number);
        if (checkWin(cartela)) {
          const player = await Player.findOne({ playerName: cartela.playerName });
          await new Winner({
            cartelaId: cartela.cartelaId,
            playerName: cartela.playerName,
            phoneNumber: player ? player.phoneNumber : '',
            link: player ? player.link : '',
            createdAt: new Date()
          }).save();
          winners.push(cartela.cartelaId);
          await cartela.save();
          break;
        }
        await cartela.save();
      }
    }
  }
  return { newNumber: number, winners };
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

// Endpoint para sortear automático
app.post('/draw', isAuthenticated, async (req, res) => {
  const result = await drawNumber();
  if (result.error) return res.status(400).json({ error: result.error });
  const game = await Game.findOne();
  const winners = (await Winner.find()).map(w => w.cartelaId);
  broadcast(game, winners);
  res.json({ number: result.newNumber, winners: result.winners });
});

// Endpoint para marcar manual
app.post('/mark-number', isAuthenticated, async (req, res) => {
  const { number } = req.body;
  const result = await markNumber(number);
  if (result.error) return res.status(400).json({ error: result.error });
  const game = await Game.findOne();
  const winners = (await Winner.find()).map(w => w.cartelaId);
  broadcast(game, winners);
  res.json({ number: result.newNumber, winners: result.winners });
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
  broadcast(await Game.findOne(), []);
  res.json({ success: true });
});

// Excluir todas as cartelas (reset attributions)
app.post('/delete-all', isAuthenticated, async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
  await Player.deleteMany({});
  await Cartela.updateMany({ playerName: { $ne: "FIXAS" } }, { playerName: "FIXAS" });
  res.json({ success: true });
});

// Excluir por telefone
app.post('/delete-by-phone', isAuthenticated, async (req, res) => {
  const { password, phoneNumber } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
  const player = await Player.findOne({ phoneNumber });
  if (!player) return res.status(404).json({ error: 'Jogador não encontrado' });
  await Cartela.updateMany({ playerName: player.playerName }, { playerName: "FIXAS" });
  await player.deleteOne();
  res.json({ success: true });
});

// Atribuir cartelas
app.post('/assign-cartelas', isAuthenticated, async (req, res) => {
  const { cartelaNumbers, playerName, phoneNumber } = req.body;
  if (!cartelaNumbers || !playerName) return res.status(400).json({ error: 'Campos obrigatórios' });
  const nums = cartelaNumbers.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
  if (!nums.length) return res.status(400).json({ error: 'Números inválidos' });
  const assigned = [];
  for (const num of nums) {
    const cartelaId = `FIXA-${num}`;
    const cartela = await Cartela.findOne({ cartelaId });
    if (cartela && cartela.playerName === "FIXAS") {
      cartela.playerName = playerName;
      await cartela.save();
      assigned.push(cartelaId);
    }
  }
  if (!assigned.length) return res.status(400).json({ error: 'Nenhuma cartela disponível para atribuição' });
  const link = `${req.protocol}://${req.get('host')}/cartelas?playerName=${encodeURIComponent(playerName)}`;
  await new Player({
    playerName,
    phoneNumber: phoneNumber || '',
    link,
    createdAt: new Date()
  }).save();
  res.json({ playerName, phoneNumber, assigned, link });
});

// WebSocket
wss.on('connection', ws => {
  Game.findOne().then(game => {
    Winner.find().then(winners => {
      ws.send(JSON.stringify({ type: 'update', game, winners: winners.map(w => w.cartelaId) }));
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
