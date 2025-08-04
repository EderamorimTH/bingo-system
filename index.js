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

// Schema para cartelas de bingo
const bingoCardSchema = new mongoose.Schema({
  rifaNumber: { type: String, unique: true, required: true }, // Ex.: "001" a "300"
  numbers: {
    B: [Number], // 5 números de 1 a 15
    I: [Number], // 5 números de 16 a 30
    N: [Number], // 4 números de 31 a 45 (centro é "Livre")
    G: [Number], // 5 números de 46 a 60
    O: [Number]  // 5 números de 61 a 75
  },
  buyerName: String,
  buyerPhone: String
});
const BingoCard = mongoose.model('BingoCard', bingoCardSchema);

// Conexão com MongoDB e inicialização
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log(`[${new Date().toISOString()}] Conectado ao MongoDB`);
    const game = await Game.findOne();
    if (!game) {
      await new Game({
        drawnNumbers: [],
        lastNumber: null,
        currentPrize: '',
        additionalInfo: '',
        startMessage: 'Em Breve o Bingo Irá Começar'
      }).save();
      console.log(`[${new Date().toISOString()}] Banco de dados "bingo" e coleção "game" criados automaticamente`);
    }
  })
  .catch(err => console.error(`[${new Date().toISOString()}] Erro ao conectar ao MongoDB:`, err));

// Função para gerar números aleatórios únicos
function getRandomNumbers(min, max, count) {
  const numbers = [];
  while (numbers.length < count) {
    const num = Math.floor(Math.random() * (max - min + 1)) + min;
    if (!numbers.includes(num)) numbers.push(num);
  }
  return numbers.sort((a, b) => a - b);
}

// Função para gerar uma cartela de bingo
function generateBingoCard() {
  return {
    B: getRandomNumbers(1, 15, 5),
    I: getRandomNumbers(16, 30, 5),
    N: getRandomNumbers(31, 45, 4), // Apenas 4 números, centro é "Livre"
    G: getRandomNumbers(46, 60, 5),
    O: getRandomNumbers(61, 75, 5)
  };
}

// Inicializar cartelas para números da rifa (001 a 300)
async function initializeBingoCards() {
  try {
    const count = await BingoCard.countDocuments();
    console.log(`[${new Date().toISOString()}] Verificando coleção 'bingocards': ${count} cartelas encontradas`);

    const rifaNumbers = Array.from({ length: 300 }, (_, i) => String(i + 1).padStart(3, '0'));
    const existingCards = await BingoCard.find({}).select('rifaNumber');
    const existingRifaNumbers = existingCards.map(card => card.rifaNumber);
    const missingRifaNumbers = rifaNumbers.filter(num => !existingRifaNumbers.includes(num));

    if (missingRifaNumbers.length > 0) {
      console.log(`[${new Date().toISOString()}] Inicializando ${missingRifaNumbers.length} cartelas faltantes...`);
      const cardsToInsert = missingRifaNumbers.map(rifaNumber => ({
        rifaNumber,
        numbers: generateBingoCard(),
        buyerName: '',
        buyerPhone: ''
      }));
      await BingoCard.insertMany(cardsToInsert);
      console.log(`[${new Date().toISOString()}] ${missingRifaNumbers.length} cartelas inseridas com sucesso`);
    }

    // Sincronizar com compras aprovadas do sistema de rifa
    const purchases = await mongoose.connection.db.collection('purchases').find({ status: 'approved' }).toArray();
    for (const purchase of purchases) {
      for (const num of purchase.numbers) {
        await BingoCard.updateOne(
          { rifaNumber: num },
          { $set: { buyerName: purchase.buyerName, buyerPhone: purchase.buyerPhone } }
        );
      }
    }
    console.log(`[${new Date().toISOString()}] Cartelas sincronizadas com compras aprovadas`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao inicializar cartelas:`, error.message);
  }
}

// Middleware para proteger rotas admin
function isAuthenticated(req, res, next) {
  if (req.cookies.auth === 'true') {
    return next();
  }
  res.redirect('/login');
}

// Rotas
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  console.log(`[${new Date().toISOString()}] Senha enviada:`, password);
  console.log(`[${new Date().toISOString()}] ADMIN_PASSWORD:`, process.env.ADMIN_PASSWORD);
  if (password === process.env.ADMIN_PASSWORD) {
    res.cookie('auth', 'true', { httpOnly: true });
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Senha incorreta' });
  }
});

app.get('/admin', isAuthenticated, (req, res) => {
  res.render('admin');
});

app.get('/display', (req, res) => {
  res.render('display');
});

// Endpoint para obter cartela por número da rifa
app.get('/card/:rifaNumber', async (req, res) => {
  const { rifaNumber } = req.params;
  try {
    const card = await BingoCard.findOne({ rifaNumber });
    if (!card) {
      return res.status(404).json({ error: 'Cartela não encontrada' });
    }
    res.json(card);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao buscar cartela:`, error.message);
    res.status(500).json({ error: 'Erro ao buscar cartela' });
  }
});

// Endpoint para sortear número
async function drawNumber() {
  const game = await Game.findOne() || new Game({
    drawnNumbers: [],
    lastNumber: null,
    currentPrize: '',
    additionalInfo: '',
    startMessage: 'Em Breve o Bingo Irá Começar'
  });
  const availableNumbers = Array.from({ length: 75 }, (_, i) => i + 1)
    .filter(n => !game.drawnNumbers.includes(n));
  if (availableNumbers.length === 0) return null;
  const newNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();
  return newNumber;
}

app.post('/draw', isAuthenticated, async (req, res) => {
  const newNumber = await drawNumber();
  if (newNumber) {
    const game = await Game.findOne();
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game }));
      }
    });
    res.json({ number: newNumber });
  } else {
    res.status(400).json({ error: 'Não há mais números para sortear' });
  }
});

// Endpoints para atualizar informações do jogo
app.post('/update-prize', isAuthenticated, async (req, res) => {
  const { currentPrize } = req.body;
  const game = await Game.findOne() || new Game({
    drawnNumbers: [],
    lastNumber: null,
    currentPrize: '',
    additionalInfo: '',
    startMessage: 'Em Breve o Bingo Irá Começar'
  });
  game.currentPrize = currentPrize;
  await game.save();
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game }));
    }
  });
  res.json({ success: true });
});

app.post('/update-info', isAuthenticated, async (req, res) => {
  const { additionalInfo } = req.body;
  const game = await Game.findOne() || new Game({
    drawnNumbers: [],
    lastNumber: null,
    currentPrize: '',
    additionalInfo: '',
    startMessage: 'Em Breve o Bingo Irá Começar'
  });
  game.additionalInfo = additionalInfo;
  await game.save();
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game }));
    }
  });
  res.json({ success: true });
});

app.post('/update-start-message', isAuthenticated, async (req, res) => {
  const { startMessage } = req.body;
  const game = await Game.findOne() || new Game({
    drawnNumbers: [],
    lastNumber: null,
    currentPrize: '',
    additionalInfo: '',
    startMessage: 'Em Breve o Bingo Irá Começar'
  });
  game.startMessage = startMessage;
  await game.save();
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game }));
    }
  });
  res.json({ success: true });
});

app.get('/game', async (req, res) => {
  const game = await Game.findOne() || {
    drawnNumbers: [],
    lastNumber: null,
    currentPrize: '',
    additionalInfo: '',
    startMessage: 'Em Breve o Bingo Irá Começar'
  };
  res.json(game);
});

// WebSocket
wss.on('connection', ws => {
  Game.findOne().then(game => {
    ws.send(JSON.stringify({
      type: 'update',
      game: game || {
        drawnNumbers: [],
        lastNumber: null,
        currentPrize: '',
        additionalInfo: '',
        startMessage: 'Em Breve o Bingo Irá Começar'
      }
    }));
  });
});

// Inicializar cartelas ao conectar ao MongoDB
mongoose.connection.once('open', async () => {
  await initializeBingoCards();
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[${new Date().toISOString()}] Servidor rodando na porta ${PORT}`));
