require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Conexões ativas
let clients = [];

// Estado do jogo
let gameState = {
  currentPrize: "--",
  additionalInfo: "--",
  lastNumber: null,
  drawnNumbers: [],
  startMessage: "Em Breve o Bingo Irá Começar"
};

// Vencedores
let winners = [];

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Configuração das views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===== ROTAS =====
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Senha incorreta!' });
  }
});

app.get('/admin', (req, res) => {
  res.render('admin', { game: gameState });
});

app.get('/display', (req, res) => {
  res.render('display');
});

app.get('/cartelas', (req, res) => {
  const playerName = "Jogador";
  const cartelas = []; // aqui você pode puxar cartelas do banco depois
  res.render('cartelas', { playerName, cartelas });
});

// Endpoint para retornar estado atual
app.get('/game', (req, res) => {
  res.json(gameState);
});

// ===== BROADCAST =====
function broadcastUpdate() {
  const payload = JSON.stringify({
    type: "update",
    game: gameState,
    winners: winners
  });

  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

// ===== WEBSOCKET =====
wss.on('connection', (ws) => {
  console.log('Novo cliente conectado');
  clients.push(ws);

  ws.on('close', () => {
    console.log('Cliente desconectado');
    clients = clients.filter(client => client !== ws);
  });
});

// ===== ROTAS DE CONTROLE DO BINGO =====
app.post('/sorteio', (req, res) => {
  const { numero } = req.body;
  if (numero && !gameState.drawnNumbers.includes(numero)) {
    gameState.drawnNumbers.push(numero);
    gameState.lastNumber = numero;
    broadcastUpdate();
  }
  res.json({ sucesso: true, game: gameState });
});

app.post('/info', (req, res) => {
  const { currentPrize, additionalInfo } = req.body;
  if (currentPrize) gameState.currentPrize = currentPrize;
  if (additionalInfo) gameState.additionalInfo = additionalInfo;
  broadcastUpdate();
  res.json({ sucesso: true, game: gameState });
});

app.post('/reset', (req, res) => {
  gameState = {
    currentPrize: "--",
    additionalInfo: "--",
    lastNumber: null,
    drawnNumbers: [],
    startMessage: "Em Breve o Bingo Irá Começar"
  };
  winners = [];
  broadcastUpdate();
  res.json({ sucesso: true, game: gameState });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
