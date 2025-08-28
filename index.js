const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const path = require('path');
const cookieParser = require('cookie-parser');
const ExcelJS = require('exceljs'); // usado para exportar cartelas
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
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
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

// Conexão com MongoDB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Conectado ao MongoDB');
    const game = await Game.findOne();
    if (!game) {
      await new Game({
        drawnNumbers: [],
        lastNumber: null,
        currentPrize: '',
        startMessage: 'Em breve o Bingo irá começar'
      }).save();
      console.log('Jogo inicial criado');
    }

    // Gerar 500 cartelas fixas apenas se não existirem
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
  .catch(err => {
    console.error('Erro ao conectar ao MongoDB:', err.message, err.stack);
  });

// Middleware de autenticação
function isAuthenticated(req, res, next) {
  try {
    if (req.cookies.auth === 'true') return next();
    res.redirect('/login');
  } catch (err) {
    console.error('Erro no middleware isAuthenticated:', err.message, err.stack);
    res.status(500).send('Erro interno no servidor');
  }
}

// Função para gerar números da cartela
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
      if (col === 2 && row === 2) {
        column.push(0);
      } else {
        const index = Math.floor(Math.random() * available.length);
        column.push(available.splice(index, 1)[0]);
      }
    }
    numbers.push(column);
  }
  return numbers;
}

// Função para obter a letra do número
function getNumberLetter(number) {
  if (!number) return '';
  if (number >= 1 && number <= 15) return 'B';
  if (number >= 16 && number <= 30) return 'I';
  if (number >= 31 && number <= 45) return 'N';
  if (number >= 46 && number <= 60) return 'G';
  if (number >= 61 && number <= 75) return 'O';
  return '';
}

// Função para broadcast
function broadcast(game, winners) {
  try {
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
            drawnNumbers: game.drawnNumbers || [],
            lastNumber: game.lastNumber,
            currentPrize: game.currentPrize || '',
            startMessage: game.startMessage || 'Em breve o Bingo irá começar',
            lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
          },
          winners: winnerData
        }));
      }
    });
  } catch (err) {
    console.error('Erro no broadcast:', err.message, err.stack);
  }
}

// Função para verificar vitória
function checkWin(cartela) {
  const marked = cartela.markedNumbers || [];
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

// Funções drawNumber e markNumber (sem alteração)...

// Rotas (mantidas iguais até o reset)

// Endpoint para reset (NÃO APAGA VENCEDORES)
app.post('/reset', isAuthenticated, async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }

    // Reseta apenas o jogo e as marcações
    await Game.deleteMany({});
    await Cartela.updateMany({}, { markedNumbers: [] });

    await new Game({
      drawnNumbers: [],
      lastNumber: null,
      currentPrize: '',
      startMessage: 'Em breve o Bingo irá começar'
    }).save();

    const game = await Game.findOne();
    const winners = await Winner.find().sort({ createdAt: -1 });

    broadcast(game, winners);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro no endpoint /reset:', err.message, err.stack);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// -------------------
// NOVO ENDPOINT PARA BAIXAR AS 500 CARTELAS
// -------------------
app.get('/download-cartelas', isAuthenticated, async (req, res) => {
  try {
    const cartelas = await Cartela.find({ playerName: "FIXAS" }).sort({ cartelaId: 1 });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Cartelas');

    sheet.columns = [
      { header: 'Cartela ID', key: 'cartelaId', width: 15 },
      { header: 'Números', key: 'numbers', width: 50 }
    ];

    cartelas.forEach(c => {
      sheet.addRow({
        cartelaId: c.cartelaId,
        numbers: c.numbers.map(col => col.join(',')).join(' | ')
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="cartelas.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Erro ao gerar Excel:', err.message, err.stack);
    res.status(500).send('Erro ao gerar cartelas');
  }
});

// WebSocket (igual ao seu, sem mudança)

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
