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

// Servir arquivos estáticos (CSS)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Configurar Mongoose para suprimir aviso de depreciação
mongoose.set('strictQuery', true);

// Schema do jogo
const gameSchema = new mongoose.Schema({
  drawnNumbers: [Number],
  lastNumber: Number,
  currentPrize: String,
  additionalInfo: String,
  startMessage: String
});
const Game = mongoose.model('Game', gameSchema);

// Schema da cartela
const cartelaSchema = new mongoose.Schema({
  cartelaId: String,
  numbers: [[Number]], // Matriz 5x5
  playerName: String,
  markedNumbers: [Number],
  createdAt: Date
});
const Cartela = mongoose.model('Cartela', cartelaSchema);

// Schema do jogador (para armazenar nome e link)
const playerSchema = new mongoose.Schema({
  playerName: String,
  link: String,
  createdAt: Date
});
const Player = mongoose.model('Player', playerSchema);

// Conexão com MongoDB e inicialização automática
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Conectado ao MongoDB');
    const game = await Game.findOne();
    if (!game) {
      await new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' }).save();
      console.log('Banco de dados "bingo" e coleção "game" criados automaticamente');
    }
  })
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// Middleware para proteger a rota /admin
function isAuthenticated(req, res, next) {
  if (req.cookies.auth === 'true') {
    return next();
  }
  res.redirect('/login');
}

// Função para gerar números da cartela
function generateCartelaNumbers() {
  const numbers = [];
  const ranges = [
    { min: 1, max: 15 }, // B
    { min: 16, max: 30 }, // I
    { min: 31, max: 45 }, // N
    { min: 46, max: 60 }, // G
    { min: 61, max: 75 } // O
  ];
  for (let col = 0; col < 5; col++) {
    const column = [];
    const { min, max } = ranges[col];
    const available = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    for (let row = 0; row < 5; row++) {
      if (col === 2 && row === 2) {
        column.push(0); // Espaço livre
        continue;
      }
      const index = Math.floor(Math.random() * available.length);
      column.push(available.splice(index, 1)[0]);
    }
    numbers.push(column);
  }
  return numbers;
}

// Rota para a raiz (redireciona para /display)
app.get('/', (req, res) => {
  res.redirect('/display');
});

// Rota de login
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  console.log('Senha enviada:', password);
  console.log('ADMIN_PASSWORD:', process.env.ADMIN_PASSWORD);
  if (password === process.env.ADMIN_PASSWORD) {
    res.cookie('auth', 'true', { httpOnly: true });
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Senha incorreta' });
  }
});

// Rotas para renderizar páginas
app.get('/admin', isAuthenticated, async (req, res) => {
  const players = await Player.find().sort({ createdAt: -1 });
  res.render('admin', { players });
});

app.get('/display', (req, res) => {
  res.render('display');
});

app.get('/cartelas', async (req, res) => {
  const { playerName } = req.query;
  if (!playerName) {
    return res.status(400).send('Nome do jogador é obrigatório');
  }
  const cartelas = await Cartela.find({ playerName });
  if (cartelas.length === 0) {
    return res.status(404).send('Nenhuma cartela encontrada para este jogador');
  }
  const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' };
  res.render('cartelas', { cartelas, playerName, game });
});

// Rota para obter lista de jogadores
app.get('/players', isAuthenticated, async (req, res) => {
  const players = await Player.find().sort({ createdAt: -1 });
  res.json(players);
});

// Rota para gerar cartela
app.post('/generate-cartela', isAuthenticated, async (req, res) => {
  const { playerName, quantity } = req.body;
  if (!playerName) {
    return res.status(400).json({ error: 'Nome do jogador é obrigatório' });
  }
  const qty = parseInt(quantity) || 1;
  const cartelaIds = [];
  for (let i = 0; i < qty; i++) {
    const cartelaId = Math.random().toString(36).substr(2, 9);
    const numbers = generateCartelaNumbers();
    const cartela = new Cartela({
      cartelaId,
      numbers,
      playerName,
      markedNumbers: [],
      createdAt: new Date()
    });
    await cartela.save();
    cartelaIds.push(cartelaId);
  }
  // Salvar jogador e link na coleção players
  const link = `${req.protocol}://${req.get('host')}/cartelas?playerName=${encodeURIComponent(playerName)}`;
  await Player.findOneAndUpdate(
    { playerName },
    { playerName, link, createdAt: new Date() },
    { upsert: true }
  );
  res.json({ playerName, cartelaIds, link });
});

// Função para sortear número
async function drawNumber() {
  const game = await Game.findOne() || new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' });
  const availableNumbers = Array.from({ length: 75 }, (_, i) => i + 1)
    .filter(n => !game.drawnNumbers.includes(n));
  if (availableNumbers.length === 0) return null;
  const newNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();
  
  // Marcar número nas cartelas e verificar vitórias
  const cartelas = await Cartela.find();
  const winners = [];
  for (const cartela of cartelas) {
    if (cartela.numbers.flat().includes(newNumber)) {
      cartela.markedNumbers.push(newNumber);
      if (checkWin(cartela)) {
        winners.push(cartela.cartelaId);
      }
      await cartela.save();
    }
  }
  
  return { newNumber, winners };
}

// Função para verificar vitória (linha horizontal)
function checkWin(cartela) {
  const marked = cartela.markedNumbers;
  for (let row = 0; row < 5; row++) {
    let markedInRow = 0;
    for (let col = 0; col < 5; col++) {
      const num = cartela.numbers[col][row];
      if (num === 0 || marked.includes(num)) {
        markedInRow++;
      }
    }
    if (markedInRow === 5) {
      return true;
    }
  }
  return false;
}

// Endpoint para sortear número
app.post('/draw', isAuthenticated, async (req, res) => {
  const result = await drawNumber();
  if (result.newNumber) {
    const game = await Game.findOne();
    const { newNumber, winners } = result;
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game, winners }));
      }
    });
    res.json({ number: newNumber, winners });
  } else {
    res.status(400).json({ error: 'Não há mais números para sortear' });
  }
});

// Endpoint para atualizar prêmio atual
app.post('/update-prize', isAuthenticated, async (req, res) => {
  const { currentPrize } = req.body;
  const game = await Game.findOne() || new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' });
  game.currentPrize = currentPrize;
  await game.save();
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game, winners: [] }));
    }
  });
  res.json({ success: true });
});

// Endpoint para atualizar informações adicionais
app.post('/update-info', isAuthenticated, async (req, res) => {
  const { additionalInfo } = req.body;
  const game = await Game.findOne() || new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' });
  game.additionalInfo = additionalInfo;
  await game.save();
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game, winners: [] }));
    }
  });
  res.json({ success: true });
});

// Endpoint para atualizar mensagem inicial
app.post('/update-start-message', isAuthenticated, async (req, res) => {
  const { startMessage } = req.body;
  const game = await Game.findOne() || new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' });
  game.startMessage = startMessage;
  await game.save();
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game, winners: [] }));
    }
  });
  res.json({ success: true });
});

// Endpoint para obter estado do jogo
app.get('/game', async (req, res) => {
  const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' };
  res.json(game);
});

// WebSocket
wss.on('connection', ws => {
  Game.findOne().then(game => {
    Cartela.find().then(cartelas => {
      ws.send(JSON.stringify({ type: 'update', game: game || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' }, winners: [] }));
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
