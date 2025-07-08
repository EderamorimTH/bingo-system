const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const path = require('path');
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

// Schema do jogo (definido antes de qualquer uso)
const gameSchema = new mongoose.Schema({
  drawnNumbers: [Number],
  lastNumber: Number,
  playersClose: Number
});
const Game = mongoose.model('Game', gameSchema);

// Conexão com MongoDB e inicialização automática
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Conectado ao MongoDB');
    // Inicializar banco e coleção automaticamente
    const game = await Game.findOne();
    if (!game) {
      await new Game({ drawnNumbers: [], lastNumber: null, playersClose: 0 }).save();
      console.log('Banco de dados "bingo" e coleção "game" criados automaticamente');
    }
  })
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// Rotas para renderizar páginas
app.get('/admin', (req, res) => {
  res.render('admin');
});

app.get('/display', (req, res) => {
  res.render('display');
});

// Função para sortear número
async function drawNumber() {
  const game = await Game.findOne() || new Game({ drawnNumbers: [], lastNumber: null, playersClose: 0 });
  const availableNumbers = Array.from({ length: 75 }, (_, i) => i + 1)
    .filter(n => !game.drawnNumbers.includes(n));
  if (availableNumbers.length === 0) return null;
  const newNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();
  return newNumber;
}

// Endpoint para sortear número
app.post('/draw', async (req, res) => {
  const newNumber = await drawNumber();
  if (newNumber) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game: { drawnNumbers: game.drawnNumbers, lastNumber: game.lastNumber, playersClose: game.playersClose } }));
      }
    });
    res.json({ number: newNumber });
  } else {
    res.status(400).json({ error: 'Não há mais números para sortear' });
  }
});

// Endpoint para atualizar jogadores próximos
app.post('/update-players-close', async (req, res) => {
  const { playersClose } = req.body;
  const game = await Game.findOne() || new Game({ drawnNumbers: [], lastNumber: null, playersClose: 0 });
  game.playersClose = playersClose;
  await game.save();
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', game }));
    }
  });
  res.json({ success: true });
});

// Endpoint para obter estado do jogo
app.get('/game', async (req, res) => {
  const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, playersClose: 0 };
  res.json(game);
});

// WebSocket
wss.on('connection', ws => {
  Game.findOne().then(game => {
    ws.send(JSON.stringify({ type: 'update', game: game || { drawnNumbers: [], lastNumber: null, playersClose: 0 } }));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
