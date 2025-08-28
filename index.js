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

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => {
    if (p.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
  }
}));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// No-cache
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Mongoose
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

const assignedCartelaSchema = new mongoose.Schema({
  cartelaId: String,
  playerName: String,
  phoneNumber: String,
  assignedAt: Date
});
const AssignedCartela = mongoose.model('AssignedCartela', assignedCartelaSchema);

// Conexão Mongo
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Conectado ao MongoDB');
    const game = await Game.findOne();
    if (!game) await new Game().save();

    // Gera cartelas fixas se não houver
    const totalCartelas = await Cartela.countDocuments({ playerName: "FIXAS" });
    if (totalCartelas === 0) {
      console.log("Gerando 500 cartelas fixas...");
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
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err.message));

// Auth
function isAuthenticated(req, res, next) {
  if (req.cookies.auth === 'true') return next();
  if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  res.redirect('/login');
}

// Utils
function generateCartelaNumbers() {
  const ranges = [
    { min: 1, max: 15 },
    { min: 16, max: 30 },
    { min: 31, max: 45 },
    { min: 46, max: 60 },
    { min: 61, max: 75 }
  ];
  const numbers = [];
  for (let col = 0; col < 5; col++) {
    const column = [];
    const { min, max } = ranges[col];
    const available = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    for (let row = 0; row < 5; row++) {
      if (col === 2 && row === 2) column.push(0); // FREE
      else column.push(available.splice(Math.floor(Math.random() * available.length), 1)[0]);
    }
    numbers.push(column);
  }
  return numbers;
}
function getNumberLetter(number) {
  if (!number) return '';
  if (number <= 15) return 'B';
  if (number <= 30) return 'I';
  if (number <= 45) return 'N';
  if (number <= 60) return 'G';
  if (number <= 75) return 'O';
  return '';
}

// Broadcast
async function doBroadcast() {
  const game = await Game.findOne();
  const winners = await Winner.find();
  const payload = {
    type: 'update',
    game: {
      drawnNumbers: game.drawnNumbers,
      lastNumber: game.lastNumber,
      currentPrize: game.currentPrize,
      startMessage: game.startMessage,
      lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
    },
    winners: winners.map(w => ({
      cartelaId: w.cartelaId,
      playerName: w.playerName,
      phoneNumber: w.phoneNumber,
      link: w.link,
      prize: w.prize
    }))
  };
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(payload));
  });
}

// Check win
function checkWin(cartela) {
  const marked = cartela.markedNumbers || [];
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      const num = cartela.numbers[col][row];
      if (num !== 0 && !marked.includes(num)) return false;
    }
  }
  return true;
}

// Marca número em todas cartelas
async function applyNumberToBoards(number) {
  const game = await Game.findOne();
  if (!game.drawnNumbers.includes(number)) game.drawnNumbers.push(number);
  game.lastNumber = number;
  await game.save();

  const alreadyHasWinner = await Winner.findOne();
  const cartelas = await Cartela.find();

  if (!alreadyHasWinner) {
    for (const cartela of cartelas) {
      if (cartela.numbers.flat().includes(number)) {
        if (!cartela.markedNumbers.includes(number)) {
          cartela.markedNumbers.push(number);
          await cartela.save();
        }
        const assigned = await AssignedCartela.findOne({ cartelaId: cartela.cartelaId });
        if (assigned && checkWin(cartela)) {
          const player = await Player.findOne({ playerName: assigned.playerName });
          await new Winner({
            cartelaId: cartela.cartelaId,
            playerName: assigned.playerName,
            phoneNumber: player ? player.phoneNumber : assigned.phoneNumber || '',
            link: player ? player.link : '',
            prize: game.currentPrize || 'Não especificado',
            createdAt: new Date()
          }).save();
          break;
        }
      }
    }
  } else {
    for (const cartela of cartelas) {
      if (cartela.numbers.flat().includes(number) && !cartela.markedNumbers.includes(number)) {
        cartela.markedNumbers.push(number);
        await cartela.save();
      }
    }
  }
}

// Rotas base
app.get('/', (req, res) => res.redirect('/display'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    res.cookie('auth', 'true', { httpOnly: true });
    return res.redirect('/admin');
  }
  res.render('login', { error: 'Senha incorreta' });
});

// Páginas
app.get('/admin', isAuthenticated, async (req, res) => {
  const game = await Game.findOne();
  const players = await Player.find();
  const winners = await Winner.find();
  res.render('admin', { players, winners, game, error: null });
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

// Rotas JSON Admin
app.get('/admin/data', isAuthenticated, async (req, res) => {
  const game = await Game.findOne();
  const players = await Player.find();
  const winners = await Winner.find();
  res.json({ game, players, winners });
});
app.post('/draw', isAuthenticated, async (req, res) => {
  const game = await Game.findOne();
  const available = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !game.drawnNumbers.includes(n));
  if (!available.length) return res.status(400).json({ error: 'Não há mais números disponíveis' });

  const number = available[Math.floor(Math.random() * available.length)];
  await applyNumberToBoards(number);
  await doBroadcast();

  const updated = await Game.findOne();
  const winners = await Winner.find();
  res.json({ ok: true, number, game: updated, winners });
});
app.post('/mark-number', isAuthenticated, async (req, res) => {
  const { number } = req.body;
  const n = parseInt(number);
  if (!n || n < 1 || n > 75) return res.status(400).json({ error: 'Número inválido' });

  await applyNumberToBoards(n);
  await doBroadcast();

  const updated = await Game.findOne();
  const winners = await Winner.find();
  res.json({ ok: true, number: n, game: updated, winners });
});
app.post('/update-prize', isAuthenticated, async (req, res) => {
  const { currentPrize } = req.body;
  const game = await Game.findOne();
  game.currentPrize = (currentPrize || '').toString();
  await game.save();
  await doBroadcast();
  res.json({ ok: true, currentPrize: game.currentPrize });
});
app.post('/reset', isAuthenticated, async (req, res) => {
  const game = await Game.findOne();
  game.drawnNumbers = [];
  game.lastNumber = null;
  await game.save();

  await Winner.deleteMany({});
  await Cartela.updateMany({}, { $set: { markedNumbers: [] } });

  await doBroadcast();
  res.json({ ok: true });
});
app.get('/game', async (req, res) => {
  const game = await Game.findOne();
  res.json(game);
});
app.post('/assign-cartelas', isAuthenticated, async (req, res) => {
  const { cartelaNumbers, playerName, phoneNumber } = req.body;
  if (!cartelaNumbers || !playerName) return res.status(400).json({ error: 'Campos obrigatórios' });

  const nums = cartelaNumbers.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
  const assigned = [];

  for (const num of nums) {
    const cartelaId = `FIXA-${num}`;
    const cartela = await Cartela.findOne({ cartelaId });
    if (!cartela) continue;

    await new AssignedCartela({
      cartelaId,
      playerName,
      phoneNumber,
      assignedAt: new Date()
    }).save();

    assigned.push(cartelaId);
  }

  let player = await Player.findOne({ playerName });
  const link = `${req.protocol}://${req.get('host')}/cartelas?playerName=${encodeURIComponent(playerName)}`;
  if (!player) {
    player = await new Player({ playerName, phoneNumber, link, cartelaIds: assigned, createdAt: new Date() }).save();
  } else {
    player.cartelaIds = [...new Set([...player.cartelaIds, ...assigned])];
    if (phoneNumber) player.phoneNumber = phoneNumber;
    await player.save();
  }

  res.json({ success: true, playerName, phoneNumber, assigned, link });
});

// WebSocket
wss.on('connection', async ws => {
  const game = await Game.findOne();
  const winners = await Winner.find();
  ws.send(JSON.stringify({
    type: 'update',
    game: {
      drawnNumbers: game.drawnNumbers,
      lastNumber: game.lastNumber,
      currentPrize: game.currentPrize,
      startMessage: game.startMessage,
      lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
    },
    winners: winners.map(w => ({
      cartelaId: w.cartelaId,
      playerName: w.playerName,
      phoneNumber: w.phoneNumber,
      link: w.link,
      prize: w.prize
    }))
  }));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
