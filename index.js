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

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Redirecionar /CARTELA-XXX para /cartelas?cartelaId=CARTELA-XXX
app.get('/:cartelaId', async (req, res) => {
  const { cartelaId } = req.params;
  if (cartelaId.startsWith('CARTELA-')) {
    try {
      const cartela = await Cartela.findOne({ cartelaId });
      if (!cartela) {
        return res.status(404).render('cartelas', { error: `Cartela ${cartelaId} não encontrada. Verifique o ID ou registre em /registro.`, cartelas: [], playerName: '', game: {} });
      }
      return res.redirect(`/cartelas?cartelaId=${cartelaId}`);
    } catch (err) {
      console.error('Erro ao redirecionar cartela:', err);
      res.status(500).render('cartelas', { error: 'Erro interno do servidor.', cartelas: [], playerName: '', game: {} });
    }
  } else {
    res.status(404).send('Cannot GET /' + cartelaId);
  }
});

// Schemas
const gameSchema = new mongoose.Schema({
  drawnNumbers: [Number],
  lastNumber: Number,
  currentPrize: String,
  additionalInfo: String,
  startMessage: String
});
const Game = mongoose.model('Game', gameSchema);

const cartelaSchema = new mongoose.Schema({
  cartelaId: String,
  numbers: [[Number]],
  playerName: String,
  phoneNumber: String,
  link: String,
  markedNumbers: [Number],
  createdAt: Date,
  isRegistered: { type: Boolean, default: false }
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
  createdAt: Date
});
const Winner = mongoose.model('Winner', winnerSchema);

// Conexão MongoDB
mongoose.set('strictQuery', true);
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

// Middleware de autenticação
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

// Função para gerar imagem PNG de uma cartela
async function generateCartelaImage(cartelaId, numbers) {
  const canvas = createCanvas(595, 842); // A4 em pixels a 72 DPI
  const ctx = canvas.getContext('2d');

  // Fundo gradiente
  const gradient = ctx.createLinearGradient(0, 0, 595, 842);
  gradient.addColorStop(0, '#34d399');
  gradient.addColorStop(1, '#3b82f6');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 595, 842);

  // Logo e título
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Bingo da Evelyn', 297.5, 50);
  ctx.font = 'bold 18px Arial';
  ctx.fillText(`Cartela de Bingo - ID: ${cartelaId}`, 297.5, 80);

  // Grade de números
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  const cellSize = 50;
  const gridX = 147.5;
  const gridY = 150;
  ctx.font = '16px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const letters = ['B', 'I', 'N', 'G', 'O'];
  for (let col = 0; col < 5; col++) {
    ctx.fillText(letters[col], gridX + col * cellSize + cellSize / 2, gridY - 20);
    for (let row = 0; row < 5; row++) {
      ctx.fillRect(gridX + col * cellSize, gridY + row * cellSize, cellSize, cellSize);
      ctx.strokeRect(gridX + col * cellSize, gridY + row * cellSize, cellSize, cellSize);
      const num = numbers[col][row];
      ctx.fillStyle = num === 0 ? '#60a5fa' : '#000000';
      ctx.fillText(num === 0 ? 'Free' : num, gridX + col * cellSize + cellSize / 2, gridY + row * cellSize + cellSize / 2);
    }
  }

  // QR Code
  const url = `https://bingo-system.onrender.com/cartelas?cartelaId=${cartelaId}`;
  const qrData = await QRCode.toDataURL(url, { width: 100 });
  const qrImg = new Image();
  qrImg.src = qrData;
  await new Promise(resolve => {
    qrImg.onload = () => {
      ctx.drawImage(qrImg, 50, 550, 100, 100);
      resolve();
    };
  });
  ctx.fillStyle = '#ffffff';
  ctx.font = '12px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Escaneie para acessar sua cartela online:', 50, 530);
  ctx.fillText('Vendida para: ________________', 50, 670);
  ctx.fillText('Telefone: ________________', 50, 690);

  return canvas.toBuffer('image/png');
}

// Rotas
app.get('/', (req, res) => {
  res.redirect('/display');
});

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
    const { cartelaId } = req.query;
    if (!cartelaId) {
      return res.status(400).render('cartelas', { error: 'Nenhum cartelaId fornecido. Acesse /registro para registrar uma cartela.', cartelas: [], playerName: '', game: {} });
    }
    const cartela = await Cartela.findOne({ cartelaId });
    if (!cartela) {
      return res.status(404).render('cartelas', { error: `Cartela ${cartelaId} não encontrada. Verifique o ID ou registre em /registro.`, cartelas: [], playerName: '', game: {} });
    }
    if (!cartela.isRegistered) {
      return res.redirect(`/registro?cartelaId=${cartelaId}`);
    }
    const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' };
    res.render('cartelas', { cartelas: [cartela], playerName: cartela.playerName, game, error: null });
  } catch (err) {
    console.error('Erro na rota /cartelas:', err);
    res.status(500).render('cartelas', { error: 'Erro interno do servidor. Tente novamente mais tarde.', cartelas: [], playerName: '', game: {} });
  }
});

app.get('/registro', (req, res) => {
  const { cartelaId } = req.query;
  res.render('registro', { error: null, cartelaId: cartelaId || '' });
});

app.post('/registro', async (req, res) => {
  const { cartelaId, playerName, phoneNumber } = req.body;
  if (!cartelaId || !playerName) {
    return res.render('registro', { error: 'Número da cartela e nome são obrigatórios', cartelaId });
  }
  try {
    const cartela = await Cartela.findOne({ cartelaId });
    if (!cartela) {
      return res.render('registro', { error: 'Cartela não encontrada', cartelaId });
    }
    if (cartela.isRegistered) {
      return res.render('registro', { error: 'Cartela já registrada', cartelaId });
    }
    cartela.playerName = playerName;
    cartela.phoneNumber = phoneNumber || '';
    cartela.link = `https://bingo-system.onrender.com/cartelas?cartelaId=${cartelaId}`;
    cartela.isRegistered = true;
    await cartela.save();
    await Player.findOneAndUpdate(
      { playerName },
      { playerName, phoneNumber: phoneNumber || '', link: cartela.link, createdAt: new Date() },
      { upsert: true }
    );
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game: null, winners: [] }));
      }
    });
    res.redirect(`/cartelas?cartelaId=${cartelaId}`);
  } catch (err) {
    console.error('Erro ao registrar cartela:', err);
    res.render('registro', { error: 'Erro ao registrar cartela', cartelaId });
  }
});

app.get('/players', isAuthenticated, async (req, res) => {
  try {
    const players = await Player.find().sort({ createdAt: -1 });
    const playersWithCartelaCount = await Promise.all(players.map(async (player) => {
      const cartelaCount = await Cartela.countDocuments({ playerName: player.playerName, isRegistered: true });
      return { ...player._doc, cartelaCount };
    }));
    res.json(playersWithCartelaCount);
  } catch (err) {
    console.error('Erro na rota /players:', err);
    res.status(500).json({ error: 'Erro ao obter jogadores' });
  }
});

app.get('/winners', isAuthenticated, async (req, res) => {
  const winners = await Winner.find().sort({ createdAt: -1 });
  res.json(winners);
});

app.post('/generate-cartela', isAuthenticated, async (req, res) => {
  const { playerName, phoneNumber, quantity } = req.body;
  if (!playerName) {
    return res.status(400).json({ error: 'Nome do jogador é obrigatório' });
  }
  const qty = parseInt(quantity) || 1;
  const cartelaIds = [];
  try {
    for (let i = 0; i < qty; i++) {
      const cartelaId = `CARTELA-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      const numbers = generateCartelaNumbers();
      const cartela = new Cartela({
        cartelaId,
        numbers,
        playerName,
        phoneNumber: phoneNumber || '',
        link: `https://bingo-system.onrender.com/cartelas?cartelaId=${cartelaId}`,
        markedNumbers: [],
        createdAt: new Date(),
        isRegistered: true // Marcar como registrada automaticamente
      });
      await cartela.save();
      cartelaIds.push(cartelaId);
    }
    await Player.findOneAndUpdate(
      { playerName },
      { playerName, phoneNumber: phoneNumber || '', link: cartelaIds[0], createdAt: new Date() },
      { upsert: true }
    );
    const game = await Game.findOne();
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game, winners: [] }));
      }
    });
    res.json({ playerName, phoneNumber, cartelaIds, link: cartelaIds[0] });
  } catch (err) {
    console.error('Erro ao gerar cartela:', err);
    res.status(500).json({ error: 'Erro ao gerar cartela' });
  }
});

app.post('/generate-print-cartelas', isAuthenticated, async (req, res) => {
  const { quantity } = req.body;
  const qty = parseInt(quantity) || 500;
  const zip = new AdmZip();
  const cartelaIds = [];
  const batchSize = 100; // Processar em lotes de 100

  try {
    for (let batch = 0; batch < Math.ceil(qty / batchSize); batch++) {
      const currentBatchSize = Math.min(batchSize, qty - batch * batchSize);
      const batchCartelas = [];
      
      // Gerar cartelas em lote
      for (let i = 1; i <= currentBatchSize; i++) {
        const index = batch * batchSize + i;
        const cartelaId = `CARTELA-${String(index).padStart(3, '0')}`;
        const numbers = generateCartelaNumbers();
        batchCartelas.push({
          cartelaId,
          numbers,
          markedNumbers: [],
          createdAt: new Date(),
          isRegistered: false
        });
        cartelaIds.push(cartelaId);
      }

      // Salvar cartelas no MongoDB
      await Cartela.insertMany(batchCartelas);
      console.log(`Lote ${batch + 1}: ${currentBatchSize} cartelas salvas`);

      // Gerar imagens para o lote
      for (const cartela of batchCartelas) {
        try {
          const imageBuffer = await generateCartelaImage(cartela.cartelaId, cartela.numbers);
          zip.addFile(`cartela-${cartela.cartelaId}.png`, imageBuffer);
        } catch (imageErr) {
          console.error(`Erro ao gerar imagem para ${cartela.cartelaId}:`, imageErr);
          throw new Error(`Erro ao gerar imagem para ${cartela.cartelaId}`);
        }
      }
    }

    // Gerar e enviar ZIP
    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=cartelas_bingo.zip');
    res.send(zipBuffer);
    console.log(`ZIP com ${qty} cartelas gerado com sucesso`);
  } catch (err) {
    console.error('Erro ao gerar cartelas para impressão:', err);
    res.status(500).json({ error: `Erro ao gerar cartelas: ${err.message}` });
  }
});

app.post('/reset', isAuthenticated, async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  try {
    await Game.updateOne({}, { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game: { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' }, winners: [] }));
      }
    });
    res.json({ message: 'Jogo reiniciado com sucesso' });
  } catch (err) {
    console.error('Erro ao reiniciar o jogo:', err);
    res.status(500).json({ error: 'Erro ao reiniciar o jogo' });
  }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
