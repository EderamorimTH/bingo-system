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
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Desabilitar cache
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Configurar Mongoose
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

// NOVO: coleção para atribuições sem mexer nas cartelas originais
const assignedCartelaSchema = new mongoose.Schema({
  cartelaId: String,
  playerName: String,
  phoneNumber: String,
  assignedAt: Date
});
const AssignedCartela = mongoose.model('AssignedCartela', assignedCartelaSchema);

// Conexão com MongoDB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Conectado ao MongoDB');
    const game = await Game.findOne();
    if (!game) await new Game().save();

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

// Middleware de autenticação
function isAuthenticated(req, res, next) {
  if (req.cookies.auth === 'true') return next();

  // Se for requisição AJAX/fetch → devolve JSON de erro
  if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  // Caso contrário (navegador normal) → redireciona pro login
  res.redirect('/login');
}

// Gerar cartela
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
      if (col === 2 && row === 2) column.push(0);
      else column.push(available.splice(Math.floor(Math.random() * available.length), 1)[0]);
    }
    numbers.push(column);
  }
  return numbers;
}

// Letra do número
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
function broadcast(game, winners) {
  const winnerData = winners.map(w => ({
    cartelaId: w.cartelaId,
    playerName: w.playerName,
    phoneNumber: w.phoneNumber,
    link: w.link,
    prize: w.prize
  }));
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'update',
        game: {
          drawnNumbers: game.drawnNumbers,
          lastNumber: game.lastNumber,
          currentPrize: game.currentPrize,
          startMessage: game.startMessage,
          lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
        },
        winners: winnerData
      }));
    }
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

// Sortear número
async function drawNumber() {
  const game = await Game.findOne();
  const available = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !game.drawnNumbers.includes(n));
  if (!available.length) return { error: 'Não há mais números' };
  const newNumber = available[Math.floor(Math.random() * available.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();

  const cartelas = await Cartela.find();
  const winners = [];
  const existingWinner = await Winner.findOne();
  if (!existingWinner) {
    for (const cartela of cartelas) {
      if (cartela.numbers.flat().includes(newNumber)) {
        cartela.markedNumbers.push(newNumber);
        if (checkWin(cartela)) {
          const player = await Player.findOne({ playerName: cartela.playerName });
          winners.push({
            cartelaId: cartela.cartelaId,
            playerName: cartela.playerName,
            phoneNumber: player ? player.phoneNumber : '',
            link: player ? player.link : '',
            prize: game.currentPrize || 'Não especificado'
          });
        }
        await cartela.save();
      }
    }
    for (const winner of winners) {
      await new Winner({ ...winner, createdAt: new Date() }).save();
    }
  }
  return { newNumber, winners };
}

// Rotas principais
app.get('/', (req, res) => res.redirect('/display'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    res.cookie('auth', 'true', { httpOnly: true });
    res.redirect('/admin');
  } else res.render('login', { error: 'Senha incorreta' });
});

// Admin
app.get('/admin', isAuthenticated, async (req, res) => {
  const game = await Game.findOne();
  const players = await Player.find();
  const winners = await Winner.find();
  res.render('admin', { players, winners, game, error: null });
});

// Display
app.get('/display', async (req, res) => {
  const game = await Game.findOne();
  const winners = await Winner.find();
  res.render('display', { game, winners });
});

// Sorteador
app.get('/sorteador', async (req, res) => {
  const game = await Game.findOne();
  const winners = await Winner.find();
  res.render('sorteador', { game, winners });
});

// Cartelas
app.get('/cartelas', async (req, res) => {
  const { playerName } = req.query;
  const cartelas = await Cartela.find({ playerName });
  const game = await Game.findOne();
  const winners = await Winner.find();
  res.render('cartelas', { cartelas, playerName, game, winners });
});

// Atribuir cartelas
app.post('/assign-cartelas', isAuthenticated, async (req, res) => {
  const { cartelaNumbers, playerName, phoneNumber } = req.body;
  if (!cartelaNumbers || !playerName) return res.status(400).json({ error: 'Campos obrigatórios' });

  const nums = cartelaNumbers.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
  const assigned = [];

  for (const num of nums) {
    const cartelaId = `FIXA-${num}`;
    const cartela = await Cartela.findOne({ cartelaId });
    if (!cartela) continue;

    // registrar atribuição sem alterar a cartela original
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
    game,
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
