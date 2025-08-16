const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const path = require('path');
const cookieParser = require('cookie-parser');
const fs = require('fs').promises;
const { createCanvas } = require('canvas');
const QRCode = require('qrcode');
const AdmZip = require('adm-zip');
require('dotenv').config();

console.log('Iniciando servidor...');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuração do Express
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
console.log('Middlewares configurados');

// Conexão com MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('Conectado ao MongoDB'))
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// Schema e Model do MongoDB
const cartelaSchema = new mongoose.Schema({
  cartelaId: { type: String, unique: true },
  numbers: [[Number]],
  playerName: String,
  phoneNumber: String,
  isRegistered: Boolean,
  link: String,
});
const Cartela = mongoose.model('Cartela', cartelaSchema);

const gameSchema = new mongoose.Schema({
  drawnNumbers: [Number],
  lastNumber: Number,
  currentPrize: String,
  additionalInfo: String,
  startMessage: String,
});
const Game = mongoose.model('Game', gameSchema);

const winnerSchema = new mongoose.Schema({
  playerName: String,
  cartelaId: String,
  createdAt: { type: Date, default: Date.now },
});
const Winner = mongoose.model('Winner', winnerSchema);

// WebSocket para atualizar clientes
wss.on('connection', ws => {
  console.log('Novo cliente WebSocket conectado');
  ws.on('close', () => console.log('Cliente WebSocket desconectado'));
});

// Função para gerar números de cartela
function generateCartelaNumbers() {
  const numbers = [[], [], [], [], []];
  for (let col = 0; col < 5; col++) {
    const min = col * 15 + 1;
    const max = col * 15 + 15;
    const columnNumbers = [];
    while (columnNumbers.length < 5) {
      const num = Math.floor(Math.random() * (max - min + 1)) + min;
      if (!columnNumbers.includes(num)) columnNumbers.push(num);
    }
    numbers[col] = columnNumbers.sort((a, b) => a - b);
  }
  numbers[2][2] = 0; // Centro da cartela é "Free"
  return numbers;
}

// Rota de teste
app.get('/test', (req, res) => {
  console.log('Rota /test acessada');
  res.send('Servidor está funcionando!');
});

// Rota inicial
app.get('/', (req, res) => {
  console.log('Acessando rota /');
  try {
    res.render('index');
  } catch (err) {
    console.error('Erro ao renderizar index.ejs:', err);
    res.status(500).send('Erro interno ao renderizar a página inicial: ' + err.message);
  }
});

// Rota de login
app.get('/login', (req, res) => {
  console.log('Acessando rota /login');
  try {
    res.render('login', { error: null });
  } catch (err) {
    console.error('Erro ao renderizar login.ejs:', err);
    res.status(500).send('Erro interno ao renderizar a página de login: ' + err.message);
  }
});

app.post('/login', (req, res) => {
  console.log('Processando POST /login');
  try {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
      res.cookie('admin', 'true', { httpOnly: true });
      res.redirect('/admin');
    } else {
      res.render('login', { error: 'Senha incorreta' });
    }
  } catch (err) {
    console.error('Erro no POST /login:', err);
    res.status(500).send('Erro interno no login: ' + err.message);
  }
});

// Rota de display
app.get('/display', async (req, res) => {
  console.log('Acessando rota /display');
  try {
    const game = await Game.findOne() || {
      drawnNumbers: [],
      lastNumber: null,
      currentPrize: '',
      additionalInfo: '',
      startMessage: 'Em Breve o Bingo Irá Começar',
    };
    res.render('display', { game });
  } catch (err) {
    console.error('Erro ao renderizar display.ejs:', err);
    res.status(500).send('Erro interno ao renderizar a página de display: ' + err.message);
  }
});

// Rota de cartelas
app.get('/cartelas', async (req, res) => {
  console.log('Acessando rota /cartelas');
  try {
    const { cartelaId } = req.query;
    if (!cartelaId) {
      return res.status(400).render('cartelas', {
        error: 'Nenhum cartelaId fornecido. Acesse /registro para registrar uma cartela.',
        cartelas: [],
        playerName: '',
        game: {},
      });
    }
    const cartela = await Cartela.findOne({ cartelaId });
    if (!cartela) {
      return res.status(404).render('cartelas', {
        error: `Cartela ${cartelaId} não encontrada. Verifique o ID ou registre em /registro.`,
        cartelas: [],
        playerName: '',
        game: {},
      });
    }
    if (!cartela.isRegistered) {
      return res.redirect(`/registro?cartelaId=${cartelaId}`);
    }
    const game = await Game.findOne() || {
      drawnNumbers: [],
      lastNumber: null,
      currentPrize: '',
      additionalInfo: '',
      startMessage: 'Em Breve o Bingo Irá Começar',
    };
    res.render('cartelas', { cartelas: [cartela], playerName: cartela.playerName, game, error: null });
  } catch (err) {
    console.error('Erro na rota /cartelas:', err);
    res.status(500).render('cartelas', {
      error: 'Erro interno do servidor: ' + err.message,
      cartelas: [],
      playerName: '',
      game: {},
    });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
