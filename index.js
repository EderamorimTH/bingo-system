const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const path = require('path');
const cookieParser = require('cookie-parser');
const fs = require('fs').promises;
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

// Configurar Mongoose
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

// Schema do jogador
const playerSchema = new mongoose.Schema({
  playerName: String,
  phoneNumber: String,
  link: String,
  createdAt: Date
});
const Player = mongoose.model('Player', playerSchema);

// Schema do vencedor
const winnerSchema = new mongoose.Schema({
  cartelaId: String,
  playerName: String,
  createdAt: Date
});
const Winner = mongoose.model('Winner', winnerSchema);

// Conexão com MongoDB
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

// Middleware para proteger rotas
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

// Função para sortear número
async function drawNumber() {
  const game = await Game.findOne();
  const availableNumbers = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !game.drawnNumbers.includes(n));
  if (availableNumbers.length === 0) return { error: 'Não há mais números para sortear' };
  const newNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();

  // Atualizar markedNumbers em todas as cartelas
  const cartelas = await Cartela.find();
  const winners = [];
  for (let cartela of cartelas) {
    if (cartela.numbers.flat().includes(newNumber)) {
      cartela.markedNumbers.push(newNumber);
      await cartela.save();
    }
    if (hasBingo(cartela)) {
      const winner = new Winner({
        cartelaId: cartela.cartelaId,
        playerName: cartela.playerName,
        createdAt: new Date()
      });
      await winner.save();
      winners.push({ cartelaId: cartela.cartelaId, playerName: cartela.playerName });
    }
  }
  return { newNumber, winners };
}

// Função para marcar número manualmente
async function markNumber(number) {
  if (isNaN(number) || number < 1 || number > 75) {
    return { error: 'Número inválido' };
  }
  const game = await Game.findOne();
  if (game.drawnNumbers.includes(number)) {
    return { error: 'Número já sorteado' };
  }
  game.drawnNumbers.push(number);
  game.lastNumber = number;
  await game.save();

  // Atualizar markedNumbers em todas as cartelas
  const cartelas = await Cartela.find();
  const winners = [];
  for (let cartela of cartelas) {
    if (cartela.numbers.flat().includes(number)) {
      cartela.markedNumbers.push(number);
      await cartela.save();
    }
    if (hasBingo(cartela)) {
      const winner = new Winner({
        cartelaId: cartela.cartelaId,
        playerName: cartela.playerName,
        createdAt: new Date()
      });
      await winner.save();
      winners.push({ cartelaId: cartela.cartelaId, playerName: cartela.playerName });
    }
  }
  return { newNumber: number, winners };
}

// Função para verificar bingo
function hasBingo(cartela) {
  const marked = new Set(cartela.markedNumbers);
  const numbers = cartela.numbers;
  // Verificar linhas
  for (let row = 0; row < 5; row++) {
    if (numbers.every((col, colIndex) => col[row] === 0 || marked.has(col[row]))) {
      return true;
    }
  }
  // Verificar colunas
  for (let col = 0; col < 5; col++) {
    if (numbers[col].every(num => num === 0 || marked.has(num))) {
      return true;
    }
  }
  // Verificar diagonais
  if (numbers.every((col, i) => col[i] === 0 || marked.has(col[i]))) return true;
  if (numbers.every((col, i) => col[4 - i] === 0 || marked.has(col[4 - i]))) return true;
  return false;
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
  const winners = await Winner.find().sort({ createdAt: -1 });
  const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' };
  res.render('admin', { players, winners, game });
});

app.get('/display', async (req, res) => {
  res.render('display');
});

app.get('/cartelas', async (req, res) => {
  try {
    const viewPath = path.join(__dirname, 'views', 'cartelas.ejs');
    await fs.access(viewPath);
    const { playerName } = req.query;
    if (!playerName) {
      return res.status(400).send('Nome do jogador é obrigatório');
    }
    const cartelas = await Cartela.find({ playerName });
    if (cartelas.length === 0) {
      return res.status(404).send('Nenhuma cartela encontrada para este jogador');
    }
    const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' };
    const winners = await Winner.find();
    res.render('cartelas', { cartelas, game, winners });
  } catch (err) {
    console.error('Erro na rota /cartelas:', err);
    res.status(500).send('Erro interno do servidor');
  }
});

// Endpoint para gerar cartela
app.post('/generate-cartela', isAuthenticated, async (req, res) => {
  const { playerName, phoneNumber, quantity } = req.body;
  const cartelas = [];
  const players = await Player.find({ playerName });
  let player;

  if (players.length > 0) {
    player = players[0];
  } else {
    player = new Player({
      playerName,
      phoneNumber,
      link: `/cartelas?playerName=${encodeURIComponent(playerName)}`,
      createdAt: new Date()
    });
    await player.save();
  }

  for (let i = 0; i < (quantity || 1); i++) {
    const cartelaId = `CARTELA-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const cartela = new Cartela({
      cartelaId,
      numbers: generateCartelaNumbers(),
      playerName,
      markedNumbers: [],
      createdAt: new Date()
    });
    await cartela.save();
    cartelas.push(cartela);
  }

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game: null, winners: [] }));
    }
  });
  res.json({ success: true, link: player.link });
});

// Endpoint para sortear número (automático)
app.post('/draw', isAuthenticated, async (req, res) => {
  try {
    const result = await drawNumber();
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    const game = await Game.findOne();
    const { newNumber, winners } = result;
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game, winners }));
      }
    });
    res.json({ number: newNumber, winners });
  } catch (err) {
    console.error('Erro na rota /draw:', err);
    res.status(500).json({ error: 'Erro ao sortear número' });
  }
});

// Endpoint para marcar número manualmente
app.post('/mark-number', isAuthenticated, async (req, res) => {
  const { number, password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  try {
    const result = await markNumber(parseInt(number));
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    const game = await Game.findOne();
    const { newNumber, winners } = result;
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game, winners }));
      }
    });
    res.json({ number: newNumber, winners });
  } catch (err) {
    console.error('Erro na rota /mark-number:', err);
    res.status(500).json({ error: 'Erro ao marcar número' });
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

// Endpoint para reiniciar o bingo
app.post('/reset', isAuthenticated, async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  await Game.deleteMany({});
  await Cartela.deleteMany({});
  await Player.deleteMany({});
  await Winner.deleteMany({});
  await new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' }).save();
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game: { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' }, winners: [] }));
    }
  });
  res.json({ success: true });
});

// Endpoint para excluir todas as cartelas
app.post('/delete-all-cartelas', isAuthenticated, async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  await Cartela.deleteMany({});
  await Player.deleteMany({});
  await Winner.deleteMany({});
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game: null, winners: [] }));
    }
  });
  res.json({ success: true });
});

// Endpoint para excluir cartelas por telefone
app.post('/delete-by-phone', isAuthenticated, async (req, res) => {
  const { phoneNumber, password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  const players = await Player.find({ phoneNumber });
  if (players.length === 0) {
    return res.status(404).json({ error: 'Nenhum jogador encontrado com este número de telefone' });
  }
  const playerNames = players.map(p => p.playerName);
  await Cartela.deleteMany({ playerName: { $in: playerNames } });
  await Player.deleteMany({ phoneNumber });
  await Winner.deleteMany({ playerName: { $in: playerNames } });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game: null, winners: [] }));
    }
  });
  res.json({ success: true });
});

// WebSocket
wss.on('connection', ws => {
  console.log('Novo cliente WebSocket conectado');
  Game.findOne().then(game => {
    Winner.find().then(winners => {
      ws.send(JSON.stringify({
        type: 'update',
        game: game || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' },
        winners
      }));
    });
  }).catch(err => {
    console.error('Erro ao inicializar WebSocket:', err);
  });
  ws.on('error', err => {
    console.error('Erro no WebSocket:', err);
  });
  ws.on('close', () => {
    console.log('Cliente WebSocket desconectado');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
