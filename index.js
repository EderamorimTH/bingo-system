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
    console.log(`Verificando existência de ${viewPath}`);
    await fs.access(viewPath);
    console.log('Arquivo cartelas.ejs encontrado');
    const { playerName } = req.query;
    console.log(`Buscando cartelas para playerName: ${playerName}`);
    if (!playerName) {
      console.log('Erro: Nome do jogador é obrigatório');
      return res.status(400).send('Nome do jogador é obrigatório');
    }
    const cartelas = await Cartela.find({ playerName });
    console.log(`Cartelas encontradas: ${cartelas.length}`);
    if (cartelas.length === 0) {
      console.log(`Nenhuma cartela encontrada para playerName: ${playerName}`);
      return res.status(404).send('Nenhuma cartela encontrada para este jogador');
    }
    const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' };
    const winnerIds = (await Winner.find()).map(w => w.cartelaId);
    console.log('Renderizando cartelas.ejs');
    res.render('cartelas', { cartelas, playerName, game, winners: winnerIds });
  } catch (err) {
    console.error('Erro na rota /cartelas:', err);
    res.status(500).send(`Internal Server Error: ${err.message}`);
  }
});

// Rota para obter lista de jogadores com contagem de cartelas
app.get('/players', isAuthenticated, async (req, res) => {
  try {
    const players = await Player.find().sort({ createdAt: -1 });
    const playersWithCartelaCount = await Promise.all(players.map(async (player) => {
      const cartelaCount = await Cartela.countDocuments({ playerName: player.playerName });
      return { ...player._doc, cartelaCount };
    }));
    res.json(playersWithCartelaCount);
  } catch (err) {
    console.error('Erro na rota /players:', err);
    res.status(500).json({ error: binge-system' });
  }
});

// Rota para obter lista de vencedores
app.get('/winners', isAuthenticated, async (req, res) => {
  const winners = await Winner.find().sort({ createdAt: -1 });
  res.json(winners);
});

// Rota para gerar cartela
app.post('/generate-cartela', isAuthenticated, async (req, res) => {
  const { playerName, phoneNumber, quantity } = req.body;
  if (!playerName) {
    return res.status(400).json({ error: 'Nome do jogador é obrigatório' });
  }
  const qty = parseInt(quantity) || 1;
  const cartelaIds = [];
  try {
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
      crtelaIds.push(cartelaId);
    }
    const link = `${req.protocol}://${req.get('host')}/cartelas?playerName=${encodeURIComponent(playerName)}`;
    await Player.findOneAndUpdate(
      { playerName },
      { playerName, phoneNumber: phoneNumber || '', link, createdAt: new Date() },
      { upsert: true }
    );
    const game = await Game.findOne();
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game, winners: [] }));
        console.log('Enviado update WebSocket após gerar cartela:', JSON.stringify({ type: 'update', game, winners: [] }));
      }
    });
    res.json({ playerName, phoneNumber, cartelaIds, link });
  } catch (err) {
    console.error('Erro ao gerar cartela:', err);
    res.status(500).json({ error: 'Erro ao gerar cartela' });
  }
});

// Rota para reiniciar o bingo
app.post('/reset', isAuthenticated, async (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
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
  } else {
    res.status(401).json({ error: 'Senha incorreta' });
  }
});

// Função para sortear número (automático)
async function drawNumber() {
  const game = await Game.findOne() || new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' });
  const availableNumbers = Array.from({ length: 75 }, (_, i) => i + 1)
    .filter(n => !game.drawnNumbers.includes(n));
  if (availableNumbers.length === 0) return null;
  const newNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();
  
  const cartelas = await Cartela.find();
  const winners = [];
  for (const cartela of cartelas) {
    if (cartela.numbers.flat().includes(newNumber)) {
      cartela.markedNumbers.push(newNumber);
      if (checkWin(cartela)) {
        winners.push(cartela.cartelaId);
        await new Winner({
          cartelaId: cartela.cartelaId,
          playerName: cartela.playerName,
          createdAt: new Date()
        }).save();
      }
      await cartela.save();
    }
  }
  
  return { newNumber, winners };
}

// Função para marcar número manualmente
async function markNumber(number) {
  if (!Number.isInteger(number) || number < 1 || number > 75) {
    return { error: 'Número inválido (deve ser entre 1 e 75)' };
  }
  const game = await Game.findOne() || new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' });
  if (game.drawnNumbers.includes(number)) {
    return { error: 'Número já sorteado' };
  }
  game.drawnNumbers.push(number);
  game.lastNumber = number;
  await game.save();
  
  const cartelas = await Cartela.find();
  const winners = [];
  for (const cartela of cartelas) {
    if (cartela.numbers.flat().includes(number)) {
      cartela.markedNumbers.push(number);
      if (checkWin(cartela)) {
        winners.push(cartela.cartelaId);
        await new Winner({
          cartelaId: cartela.cartelaId,
          playerName: cartela.playerName,
          createdAt: new Date()
        }).save();
      }
      await cartela.save();
    }
  }
  
  return { newNumber: number, winners };
}

// Função para verificar vitória (todos os números)
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

// Endpoint para sortear número (automático)
app.post('/draw', isAuthenticated, async (req, res) => {
  try {
    const result = await drawNumber();
    if (result && result.newNumber) {
      const game = await Game.findOne();
      const { newNumber, winners } = result;
      console.log(`Número sorteado automaticamente: ${newNumber}, Vencedores: ${winners}`);
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'update', game, winners }));
          console.log('Enviado update WebSocket para sorteio automático:', JSON.stringify({ type: 'update', game, winners }));
        }
      });
      res.json({ number: newNumber, winners });
    } else {
      res.status(400).json({ error: 'Não há mais números para sortear' });
    }
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
    console.log(`Número marcado manualmente: ${newNumber}, Vencedores: ${winners}`);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game, winners }));
        console.log('Enviado update WebSocket para marcação manual:', JSON.stringify({ type: 'update', game, winners }));
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
      console.log('Enviado update WebSocket para prêmio:', JSON.stringify({ type: 'update', game, winners: [] }));
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
      console.log('Enviado update WebSocket para informações:', JSON.stringify({ type: 'update', game, winners: [] }));
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
      console.log('Enviado update WebSocket para mensagem inicial:', JSON.stringify({ type: 'update', game, winners: [] }));
    }
  });
  res.json({ success: true });
});

// Endpoint para obter estado do jogo
app.get('/game', async (req, res) => {
  const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' };
  console.log('Estado do jogo enviado para /game:', game);
  res.json(game);
});

// WebSocket
wss.on('connection', ws => {
  console.log('Novo cliente WebSocket conectado');
  Game.findOne().then(game => {
    Cartela.find().then(cartelas => {
      const data = JSON.stringify({ type: 'update', game: game || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' }, winners: [] });
      ws.send(data);
      console.log('Enviado estado inicial WebSocket:', data);
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
