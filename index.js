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

// Servir arquivos estáticos com tipo MIME correto
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
  cartelaId: { type: String, unique: true, immutable: true },
  numbers: { type: [[Number]], immutable: true },
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
    console.log('Autenticação falhou, redirecionando para /login');
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
    if (!game) {
      console.warn('Game não encontrado no broadcast');
      return;
    }
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

// Função para verificar vitória (cartela cheia)
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

// Função para sortear número
async function drawNumber() {
  try {
    const game = await Game.findOne();
    if (!game) return { error: 'Jogo não encontrado' };
    const available = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !game.drawnNumbers.includes(n));
    if (!available.length) return { error: 'Não há mais números para sortear' };
    const newNumber = available[Math.floor(Math.random() * available.length)];
    game.drawnNumbers.push(newNumber);
    game.lastNumber = newNumber;
    await game.save();
    const cartelas = await Cartela.find({ playerName: { $ne: "FIXAS" } });
    const winners = [];
    const existingWinner = await Winner.findOne();
    if (!existingWinner) {
      for (const cartela of cartelas) {
        if (cartela.numbers.flat().includes(newNumber)) {
          cartela.markedNumbers.push(newNumber);
          if (checkWin(cartela)) {
            const player = await Player.findOne({ playerName: cartela.playerName });
            winners.push({
              cartelaId: cartela.cartelaId,
              playerName: cartela.playerName,
              phoneNumber: player ? player.phoneNumber : '',
              link: player ? player.link : '',
              prize: game.currentPrize || 'Não especificado'
            });
          }
          await cartela.save();
        }
      }
      if (winners.length > 0) {
        for (const winner of winners) {
          await new Winner({
            cartelaId: winner.cartelaId,
            playerName: winner.playerName,
            phoneNumber: winner.phoneNumber,
            link: winner.link,
            prize: winner.prize,
            createdAt: new Date()
          }).save();
        }
      }
    }
    return { newNumber, winners };
  } catch (err) {
    console.error('Erro no drawNumber:', err.message, err.stack);
    return { error: 'Erro interno no servidor' };
  }
}

// Função para marcar número manualmente
async function markNumber(number) {
  try {
    number = parseInt(number);
    if (!Number.isInteger(number) || number < 1 || number > 75) return { error: 'Número inválido' };
    const game = await Game.findOne();
    if (!game) return { error: 'Jogo não encontrado' };
    if (game.drawnNumbers.includes(number)) return { error: 'Número já sorteado' };
    game.drawnNumbers.push(number);
    game.lastNumber = number;
    await game.save();
    const cartelas = await Cartela.find({ playerName: { $ne: "FIXAS" } });
    const winners = [];
    const existingWinner = await Winner.findOne();
    if (!existingWinner) {
      for (const cartela of cartelas) {
        if (cartela.numbers.flat().includes(number)) {
          cartela.markedNumbers.push(number);
          if (checkWin(cartela)) {
            const player = await Player.findOne({ playerName: cartela.playerName });
            winners.push({
              cartelaId: cartela.cartelaId,
              playerName: cartela.playerName,
              phoneNumber: player ? player.phoneNumber : '',
              link: player ? player.link : '',
              prize: game.currentPrize || 'Não especificado'
            });
          }
          await cartela.save();
        }
      }
      if (winners.length > 0) {
        for (const winner of winners) {
          await new Winner({
            cartelaId: winner.cartelaId,
            playerName: winner.playerName,
            phoneNumber: winner.phoneNumber,
            link: winner.link,
            prize: winner.prize,
            createdAt: new Date()
          }).save();
        }
      }
    }
    return { newNumber: number, winners };
  } catch (err) {
    console.error('Erro no markNumber:', err.message, err.stack);
    return { error: 'Erro interno no servidor' };
  }
}

// Rotas
app.get('/', (req, res) => res.redirect('/display'));

app.get('/login', (req, res) => {
  try {
    res.render('login', { error: null });
  } catch (err) {
    console.error('Erro ao renderizar login:', err.message, err.stack);
    res.status(500).send('Erro ao carregar a página de login');
  }
});

app.post('/login', (req, res) => {
  try {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
      res.cookie('auth', 'true', { httpOnly: true });
      res.redirect('/admin');
    } else {
      res.render('login', { error: 'Senha incorreta' });
    }
  } catch (err) {
    console.error('Erro no login:', err.message, err.stack);
    res.status(500).send('Erro interno no servidor');
  }
});

// ⚠️ Aqui estava o erro! Corrigido:
app.post('/assign-cartelas', isAuthenticated, async (req, res) => {
  try {
    const { cartelaNumbers, playerName, phoneNumber } = req.body;
    if (!cartelaNumbers || !playerName) return res.status(400).json({ error: 'Campos obrigatórios' });
    const nums = cartelaNumbers.split(',').map(n => n.trim()).filter(n => n.match(/^\d+$/)).map(n => parseInt(n));
    if (!nums.length) return res.status(400).json({ error: 'Números inválidos' });
    const assigned = [];
    const errors = [];
    for (const num of nums) {
      const cartelaId = `FIXA-${num}`;
      const cartela = await Cartela.findOne({ cartelaId });
      if (!cartela) {
        errors.push(`Cartela FIXA-${num} não existe`);
        continue;
      }
      if (cartela.playerName !== "FIXAS") {
        errors.push(`Cartela ${cartelaId} já atribuída a ${cartela.playerName}`);
        continue;
      }
      cartela.playerName = playerName;
      await cartela.save();
      assigned.push(cartelaId);
    }
    if (!assigned.length) return res.status(400).json({ error: errors.join('; ') || 'Nenhuma cartela disponível para atribuição' });

    // ✅ LINHA CORRIGIDA
    const link = `${req.protocol}://${req.get('host')}/cartelas?playerName=${encodeURIComponent(playerName)}`;

    let player = await Player.findOne({ playerName });
    if (!player) {
      player = await new Player({
        playerName,
        phoneNumber: phoneNumber || '',
        link,
        cartelaIds: assigned,
        createdAt: new Date()
      }).save();
    } else {
      player.cartelaIds = [...new Set([...player.cartelaIds, ...assigned])];
      if (phoneNumber) player.phoneNumber = phoneNumber;
      await player.save();
    }
    const game = await Game.findOne();
    broadcast(game, await Winner.find());
    res.json({ success: true, playerName, phoneNumber, assigned, link });
  } catch (err) {
    console.error('Erro no endpoint /assign-cartelas:', err.message, err.stack);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// (restante do código igual ao que já te mandei, sem mudar cores, design, etc...)

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
