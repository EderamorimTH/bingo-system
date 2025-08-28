const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const path = require('path');
const cookieParser = require('cookie-parser');
const ExcelJS = require('exceljs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

mongoose.set('strictQuery', true);

// Schemas
const gameSchema = new mongoose.Schema({
  drawnNumbers: { type: [Number], default: [] },
  lastNumber: { type: Number, default: null },
  currentPrize: { type: String, default: '' },
  startMessage: { type: String, default: 'Em breve o Bingo irá começar' }
});
const Game = mongoose.model('Game', gameSchema);

const cartelaSchema = new mongoose.Schema({
  cartelaId: String,
  numbers: [[Number]],
  playerName: String,
  markedNumbers: { type: [Number], default: [] },
  createdAt: Date
});
const Cartela = mongoose.model('Cartela', cartelaSchema);

const playerSchema = new mongoose.Schema({
  playerName: String,
  phoneNumber: String,
  link: String,
  cartelaIds: { type: [String], default: [] },
  createdAt: Date
});
const Player = mongoose.model('Player', playerSchema);

const winnerSchema = new mongoose.Schema({
  cartelaId: String,
  playerName: String,
  phoneNumber: String,
  link: String,
  prize: String,
  createdAt: Date
});
const Winner = mongoose.model('Winner', winnerSchema);

// Conectar Mongo
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true }).then(async () => {
  let game = await Game.findOne();
  if (!game) await new Game({}).save();

  const count = await Cartela.countDocuments({ playerName: "FIXAS" });
  if (count === 0) {
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
  }
});

// Utils
function isAuthenticated(req, res, next) {
  if (req.cookies.auth === 'true') return next();
  res.redirect('/login');
}

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

function getNumberLetter(n) {
  if (n >= 1 && n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  if (n <= 75) return 'O';
  return '';
}

function broadcast(game, winners) {
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(JSON.stringify({ type: 'update', game, winners }));
    }
  });
}

function checkWin(cartela) {
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      const n = cartela.numbers[col][row];
      if (n !== 0 && !cartela.markedNumbers.includes(n)) return false;
    }
  }
  return true;
}

// Rotas principais
app.get('/', (req, res) => res.redirect('/display'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    res.cookie('auth', 'true'); res.redirect('/admin');
  } else res.render('login', { error: 'Senha incorreta' });
});

app.get('/admin', isAuthenticated, async (req, res) => {
  const game = await Game.findOne();
  const players = await Player.find();
  const winners = await Winner.find();
  res.render('admin', { players, winners, game });
});
app.get('/admin/data', isAuthenticated, async (req, res) => {
  res.json({ players: await Player.find(), winners: await Winner.find() });
});

app.get('/display', async (req, res) => {
  const game = await Game.findOne();
  const winners = await Winner.find();
  res.render('display', { game, winners });
});

app.get('/sorteador', async (req, res) => {
  const game = await Game.findOne();
  const winners = await Winner.find();
  res.render('sorteador', { game, winners });
});

app.get('/cartelas', async (req, res) => {
  const { playerName } = req.query;
  const cartelas = await Cartela.find({ playerName });
  const game = await Game.findOne();
  const winners = await Winner.find();
  res.render('cartelas', { cartelas, playerName, game, winners });
});

app.get('/cartelas-fixas', async (req, res) => {
  const cartelas = await Cartela.find({ playerName: "FIXAS" });
  const game = await Game.findOne();
  res.render('cartelas', { cartelas, playerName: "Cartelas Fixas", game, winners: [] });
});

// APIs auxiliares
app.get('/game', async (req, res) => res.json(await Game.findOne()));
app.get('/winners', async (req, res) => res.json(await Winner.find()));

// Sorteio
app.post('/draw', isAuthenticated, async (req, res) => {
  const game = await Game.findOne();
  const available = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !game.drawnNumbers.includes(n));
  if (!available.length) return res.json({ error: 'Todos os números já foram sorteados' });
  const newNumber = available[Math.floor(Math.random() * available.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();

  const winners = await checkWinners(game, newNumber);
  broadcast(game, winners);
  res.json({ number: newNumber, winners });
});

app.post('/mark-number', isAuthenticated, async (req, res) => {
  const { number, password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
  const game = await Game.findOne();
  if (game.drawnNumbers.includes(number)) return res.json({ error: 'Número já marcado' });
  game.drawnNumbers.push(number);
  game.lastNumber = number;
  await game.save();
  const winners = await checkWinners(game, number);
  broadcast(game, winners);
  res.json({ number, winners });
});

async function checkWinners(game, number) {
  const cartelas = await Cartela.find({ playerName: { $ne: "FIXAS" } });
  const winners = [];
  for (const cartela of cartelas) {
    if (cartela.numbers.flat().includes(number)) {
      cartela.markedNumbers.push(number);
      if (checkWin(cartela)) {
        const player = await Player.findOne({ playerName: cartela.playerName });
        winners.push({
          cartelaId: cartela.cartelaId,
          playerName: cartela.playerName,
          phoneNumber: player?.phoneNumber || '',
          link: player?.link || '',
          prize: game.currentPrize
        });
      }
      await cartela.save();
    }
  }
  if (winners.length) {
    for (const w of winners) await new Winner({ ...w, createdAt: new Date() }).save();
  }
  return winners;
}

// Atualizar prêmio
app.post('/update-prize', isAuthenticated, async (req, res) => {
  const game = await Game.findOne();
  game.currentPrize = req.body.currentPrize;
  await game.save();
  broadcast(game, await Winner.find());
  res.json({ success: true });
});

// Reset
app.post('/reset', isAuthenticated, async (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
  await Game.deleteMany({});
  await Winner.deleteMany({});
  await Cartela.updateMany({}, { markedNumbers: [] });
  await new Game({}).save();
  broadcast(await Game.findOne(), []);
  res.json({ success: true });
});

// Excluir todos jogadores
app.post('/delete-all', isAuthenticated, async (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
  await Player.deleteMany({});
  await Cartela.updateMany({ playerName: { $ne: "FIXAS" } }, { playerName: "FIXAS", markedNumbers: [] });
  res.json({ success: true });
});

// Excluir por telefone
app.post('/delete-by-phone', isAuthenticated, async (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
  const player = await Player.findOne({ phoneNumber: req.body.phoneNumber });
  if (player) {
    await Cartela.updateMany({ playerName: player.playerName }, { playerName: "FIXAS", markedNumbers: [] });
    await player.deleteOne();
  }
  res.json({ success: true });
});

// Atribuir cartelas
app.post('/assign-cartelas', isAuthenticated, async (req, res) => {
  const { cartelaNumbers, playerName, phoneNumber } = req.body;
  const numbers = cartelaNumbers.split(',').map(n => parseInt(n.trim())).filter(Boolean);
  const assigned = [];
  for (const num of numbers) {
    const id = `FIXA-${num}`;
    const c = await Cartela.findOne({ cartelaId: id });
    if (c && c.playerName === "FIXAS") {
      c.playerName = playerName;
      await c.save();
      assigned.push(id);
    }
  }
  let player = await Player.findOne({ playerName });
  const link = `${req.protocol}://${req.get('host')}/cartelas?playerName=${encodeURIComponent(playerName)}`;
  if (!player) {
    player = new Player({ playerName, phoneNumber, link, cartelaIds: assigned, createdAt: new Date() });
  } else {
    player.cartelaIds.push(...assigned);
    player.phoneNumber = phoneNumber;
  }
  await player.save();
  res.json({ success: true, assigned });
});

// Download cartelas (Excel 5x5)
app.get('/download-cartelas', isAuthenticated, async (req, res) => {
  const cartelas = await Cartela.find({ playerName: "FIXAS" }).sort((a, b) => parseInt(a.cartelaId.split('-')[1]) - parseInt(b.cartelaId.split('-')[1]));
  const workbook = new ExcelJS.Workbook();
  cartelas.forEach(c => {
    const sheet = workbook.addWorksheet(c.cartelaId);
    sheet.addRow([`Cartela ${c.cartelaId}`]);
    sheet.addRow(["B","I","N","G","O"]);
    for (let r = 0; r < 5; r++) {
      sheet.addRow(c.numbers.map(col => col[r] === 0 ? "X" : col[r]));
    }
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="cartelas.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
