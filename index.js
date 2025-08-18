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
  prize: String,
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
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// Middleware auth
function isAuthenticated(req, res, next) {
  if (req.cookies.auth === 'true') return next();
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

// Função para obter a letra do número
function getNumberLetter(number) {
  if (number >= 1 && number <= 15) return 'B';
  if (number >= 16 && number <= 30) return 'I';
  if (number >= 31 && number <= 45) return 'N';
  if (number >= 46 && number <= 60) return 'G';
  if (number >= 61 && number <= 75) return 'O';
  return '';
}

// Função para broadcast
function broadcast(game, winners) {
  if (!game) return;
  const data = JSON.stringify({ type: 'update', game, winners: [] });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Função para checkWin
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

// Função para drawNumber
async function drawNumber() {
  const game = await Game.findOne();
  const availableNumbers = Array.from({ length: 75 }, (_, i) => i + 1)
    .filter(n => !game.drawnNumbers.includes(n));
  if (availableNumbers.length === 0) return null;
  const newNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();
  
  const cartelas = await Cartela.find();
  const winners = [];
  const existingWinners = await Winner.find();
  if (existingWinners.length === 0) {
    for (const cartela of cartelas) {
      if (cartela.playerName === "FIXAS") continue;
      if (cartela.numbers.flat().includes(newNumber)) {
        cartela.markedNumbers.push(newNumber);
        if (checkWin(cartela)) {
          winners.push(cartela.cartelaId);
          const player = await Player.findOne({ playerName: cartela.playerName });
          await new Winner({
            cartelaId: cartela.cartelaId,
            playerName: cartela.playerName,
            phoneNumber: player ? player.phoneNumber : '',
            link: player ? player.link : '',
            prize: game.currentPrize,
            createdAt: new Date()
          }).save();
        }
        await cartela.save();
      }
    }
  }
  
  return { newNumber, winners };
}

// Função para markNumber
async function markNumber(number) {
  if (!Number.isInteger(number) || number < 1 || number > 75) {
    return { error: 'Número inválido (deve ser entre 1 e 75)' };
  }
  const game = await Game.findOne();
  if (game.drawnNumbers.includes(number)) {
    return { error: 'Número já sorteado' };
  }
  game.drawnNumbers.push(number);
  game.lastNumber = number;
  await game.save();
  
  const cartelas = await Cartela.find();
  const winners = [];
  const existingWinners = await Winner.find();
  if (existingWinners.length === 0) {
    for (const cartela of cartelas) {
      if (cartela.playerName === "FIXAS") continue;
      if (cartela.numbers.flat().includes(number)) {
        cartela.markedNumbers.push(number);
        if (checkWin(cartela)) {
          winners.push(cartela.cartelaId);
          const player = await Player.findOne({ playerName: cartela.playerName });
          await new Winner({
            cartelaId: cartela.cartelaId,
            playerName: cartela.playerName,
            phoneNumber: player ? player.phoneNumber : '',
            link: player ? player.link : '',
            prize: game.currentPrize,
            createdAt: new Date()
          }).save();
        }
        await cartela.save();
      }
    }
  }
  
  return { newNumber: number, winners };
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
  const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', startMessage: 'Em Breve o Bingo Irá Começar' };
  res.render('admin', { players, winners, game });
});

app.get('/display', async (req, res) => {
  res.render('display');
});

app.get('/sorteador', async (req, res) => {
  const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' };
  const winners = await Winner.find().sort({ createdAt: -1 });
  res.render('sorteador', { game, winners });
});

app.get('/cartelas', async (req, res) => {
  try {
    const { playerName } = req.query;
    if (!playerName) {
      return res.status(400).send('Nome do jogador é obrigatório');
    }
    const cartelas = await Cartela.find({ playerName });
    if (cartelas.length === 0) {
      return res.status(404).send('Nenhuma cartela encontrada para este jogador');
    }
    const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' };
    const winnerIds = (await Winner.find()).map(w => w.cartelaId);
    res.render('cartelas', { cartelas, playerName, game, winners: winnerIds });
  } catch (err) {
    console.error('Erro na rota /cartelas:', err);
    res.status(500).send(`Internal Server Error: ${err.message}`);
  }
});

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
