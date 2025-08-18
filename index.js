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

// Servir arquivos estáticos com verificação
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
    if (totalCartelas < 500) {
      console.log("Gerando 500 cartelas fixas...");
      await Cartela.deleteMany({ playerName: "FIXAS" });
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
    console.error('Erro ao conectar ao MongoDB:', err);
  });

// Middleware auth
function isAuthenticated(req, res, next) {
  try {
    if (req.cookies.auth === 'true') return next();
    console.log('Autenticação falhou, redirecionando para /login');
    res.redirect('/login');
  } catch (err) {
    console.error('Erro no middleware isAuthenticated:', err);
    res.status(500).send('Erro interno no servidor');
  }
}

// Função para gerar cartela
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

// Função para obter a letra de um número
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
    const winnerIds = winners.map(w => w.cartelaId);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'update',
          game: {
            ...game.toObject(),
            lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
          },
          winners: winnerIds
        }));
      }
    });
  } catch (err) {
    console.error('Erro no broadcast:', err);
  }
}

// Função checkWin
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

// Função drawNumber
async function drawNumber() {
  try {
    const game = await Game.findOne();
    if (!game) return { error: 'Jogo não encontrado' };
    const available = Array.from({length: 75}, (_, i) => i+1).filter(n => !game.drawnNumbers.includes(n));
    if (!available.length) return { error: 'Não há mais números para sortear' };
    const newNumber = available[Math.floor(Math.random() * available.length)];
    game.drawnNumbers.push(newNumber);
    game.lastNumber = newNumber;
    await game.save();
    const cartelas = await Cartela.find();
    const winners = [];
    const existingWinner = await Winner.findOne();
    if (!existingWinner) {
      for (const cartela of cartelas) {
        if (cartela.playerName === "FIXAS") continue;
        if (cartela.numbers.flat().includes(newNumber)) {
          cartela.markedNumbers.push(newNumber);
          if (checkWin(cartela)) {
            const player = await Player.findOne({ playerName: cartela.playerName });
            winners.push({
              cartelaId: cartela.cartelaId,
              playerName: cartela.playerName,
              phoneNumber: player ? player.phoneNumber : '',
              link: player ? player.link : ''
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
            createdAt: new Date()
          }).save();
        }
      }
    }
    return { newNumber, winners };
  } catch (err) {
    console.error('Erro no drawNumber:', err);
    return { error: 'Erro interno no servidor' };
  }
}

// Função markNumber
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
    const cartelas = await Cartela.find();
    const winners = [];
    const existingWinner = await Winner.findOne();
    if (!existingWinner) {
      for (const cartela of cartelas) {
        if (cartela.playerName === "FIXAS") continue;
        if (cartela.numbers.flat().includes(number)) {
          cartela.markedNumbers.push(number);
          if (checkWin(cartela)) {
            const player = await Player.findOne({ playerName: cartela.playerName });
            winners.push({
              cartelaId: cartela.cartelaId,
              playerName: cartela.playerName,
              phoneNumber: player ? player.phoneNumber : '',
              link: player ? player.link : ''
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
            createdAt: new Date()
          }).save();
        }
      }
    }
    return { newNumber: number, winners };
  } catch (err) {
    console.error('Erro no markNumber:', err);
    return { error: 'Erro interno no servidor' };
  }
}

// Rotas
app.get('/', (req, res) => res.redirect('/display'));

app.get('/login', (req, res) => {
  try {
    res.render('login', { error: null });
  } catch (err) {
    console.error('Erro ao renderizar login:', err);
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
    console.error('Erro no login:', err);
    res.status(500).send('Erro interno no servidor');
  }
});

app.get('/admin', isAuthenticated, async (req, res) => {
  try {
    const players = await Player.find().sort({ createdAt: -1 }) || [];
    const winners = await Winner.find().sort({ createdAt: -1 }) || [];
    const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null, currentPrize: '', startMessage: 'Em breve o Bingo irá começar' };
    const playersWithCartelas = await Promise.all(players.map(async (player) => {
      const cartelas = await Cartela.find({ playerName: player.playerName });
      return {
        ...player.toObject(),
        cartelaIds: cartelas.map(c => c.cartelaId)
      };
    }));
    res.render('admin', {
      players: playersWithCartelas,
      winners,
      game: {
        ...game,
        lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      error: null
    });
  } catch (err) {
    console.error('Erro ao renderizar admin:', err);
    res.status(500).render('admin', {
      players: [],
      winners: [],
      game: { drawnNumbers: [], lastNumber: null, currentPrize: '', startMessage: 'Erro ao carregar dados' },
      error: 'Erro ao carregar o painel de administração. Verifique a conexão com o banco de dados.'
    });
  }
});

app.get('/display', async (req, res) => {
  try {
    const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null };
    res.render('display', {
      game: {
        ...game,
        lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      }
    });
  } catch (err) {
    console.error('Erro ao renderizar display:', err);
    res.status(500).send('Erro ao carregar a página de exibição');
  }
});

app.get('/sorteador', async (req, res) => {
  try {
    const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null };
    const winners = await Winner.find().sort({ createdAt: -1 }) || [];
    res.render('sorteador', {
      game: {
        ...game,
        lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      winners
    });
  } catch (err) {
    console.error('Erro ao renderizar sorteador:', err);
    res.status(500).send('Erro ao carregar a página do sorteador');
  }
});

app.get('/cartelas', async (req, res) => {
  try {
    const { playerName } = req.query;
    if (!playerName) return res.status(400).send('Nome do jogador é obrigatório');
    const cartelas = await Cartela.find({ playerName });
    if (cartelas.length === 0) return res.status(404).send('Nenhuma cartela encontrada');
    const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null };
    const winnerIds = (await Winner.find()).map(w => w.cartelaId);
    res.render('cartelas', {
      cartelas,
      playerName,
      game: {
        ...game,
        lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      winners: winnerIds
    });
  } catch (err) {
    console.error('Erro ao renderizar cartelas:', err);
    res.status(500).send('Erro ao carregar a página de cartelas');
  }
});

app.get('/cartelas-fixas', async (req, res) => {
  try {
    const cartelas = await Cartela.find({ playerName: "FIXAS" });
    const game = await Game.findOne() || { drawnNumbers: [], lastNumber: null };
    res.render('cartelas', {
      cartelas,
      playerName: "Cartelas Fixas",
      game: {
        ...game,
        lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      winners: []
    });
  } catch (err) {
    console.error('Erro ao renderizar cartelas-fixas:', err);
    res.status(500).send('Erro ao carregar a página de cartelas fixas');
  }
});

// Endpoint para sortear automático
app.post('/draw', isAuthenticated, async (req, res) => {
  try {
    const result = await drawNumber();
    if (result.error) return res.status(400).json({ error: result.error });
    const game = await Game.findOne();
    const winners = await Winner.find();
    broadcast(game, winners);
    res.json({ number: result.newNumber, winners: result.winners });
  } catch (err) {
    console.error('Erro no endpoint /draw:', err);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Endpoint para marcar manual
app.post('/mark-number', isAuthenticated, async (req, res) => {
  try {
    const { number, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
    const result = await markNumber(number);
    if (result.error) return res.status(400).json({ error: result.error });
    const game = await Game.findOne();
    const winners = await Winner.find();
    broadcast(game, winners);
    res.json({ number: result.newNumber, winners: result.winners });
  } catch (err) {
    console.error('Erro no endpoint /mark-number:', err);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Endpoint para atualizar prêmio
app.post('/update-prize', isAuthenticated, async (req, res) => {
  try {
    const { currentPrize } = req.body;
    const game = await Game.findOne();
    game.currentPrize = currentPrize;
    await game.save();
    broadcast(game, await Winner.find());
    res.json({ success: true });
  } catch (err) {
    console.error('Erro no endpoint /update-prize:', err);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Reset sem apagar cartelas
app.post('/reset', isAuthenticated, async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
    await Game.deleteMany({});
    await Winner.deleteMany({});
    const cartelas = await Cartela.find();
    for (const c of cartelas) {
      c.markedNumbers = [];
      await c.save();
    }
    await new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', startMessage: 'Em breve o Bingo irá começar' }).save();
    const game = await Game.findOne();
    broadcast(game, []);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro no endpoint /reset:', err);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Excluir todas as cartelas (reset attributions)
app.post('/delete-all', isAuthenticated, async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
    await Player.deleteMany({});
    await Cartela.updateMany({ playerName: { $ne: "FIXAS" } }, { playerName: "FIXAS" });
    const game = await Game.findOne();
    broadcast(game, await Winner.find());
    res.json({ success: true });
  } catch (err) {
    console.error('Erro no endpoint /delete-all:', err);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Excluir por telefone
app.post('/delete-by-phone', isAuthenticated, async (req, res) => {
  try {
    const { password, phoneNumber } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
    const player = await Player.findOne({ phoneNumber });
    if (!player) return res.status(404).json({ error: 'Jogador não encontrado' });
    await Cartela.updateMany({ playerName: player.playerName }, { playerName: "FIXAS" });
    await player.deleteOne();
    const game = await Game.findOne();
    broadcast(game, await Winner.find());
    res.json({ success: true });
  } catch (err) {
    console.error('Erro no endpoint /delete-by-phone:', err);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Atribuir cartelas
app.post('/assign-cartelas', isAuthenticated, async (req, res) => {
  try {
    const { cartelaNumbers, playerName, phoneNumber } = req.body;
    if (!cartelaNumbers || !playerName) return res.status(400).json({ error: 'Campos obrigatórios' });
    const nums = cartelaNumbers.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    if (!nums.length) return res.status(400).json({ error: 'Números inválidos' });
    const assigned = [];
    for (const num of nums) {
      const cartelaId = `FIXA-${num}`;
      const cartela = await Cartela.findOne({ cartelaId });
      if (cartela && cartela.playerName === "FIXAS") {
        cartela.playerName = playerName;
        await cartela.save();
        assigned.push(cartelaId);
      }
    }
    if (!assigned.length) return res.status(400).json({ error: 'Nenhuma cartela disponível para atribuição' });
    const link = `${req.protocol}://${req.get('host')}/cartelas?playerName=${encodeURIComponent(playerName)}`;
    await new Player({
      playerName,
      phoneNumber: phoneNumber || '',
      link,
      createdAt: new Date()
    }).save();
    const game = await Game.findOne();
    broadcast(game, await Winner.find());
    res.json({ success: true, playerName, phoneNumber, assigned, link });
  } catch (err) {
    console.error('Erro no endpoint /assign-cartelas:', err);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// WebSocket
wss.on('connection', ws => {
  try {
    Game.findOne().then(game => {
      if (!game) {
        game = { drawnNumbers: [], lastNumber: null, currentPrize: '', startMessage: 'Em breve o Bingo irá começar' };
      }
      Winner.find().then(winners => {
        ws.send(JSON.stringify({
          type: 'update',
          game: {
            ...game,
            lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
          },
          winners: winners.map(w => w.cartelaId)
        }));
      }).catch(err => {
        console.error('Erro ao buscar winners no WebSocket:', err);
      });
    }).catch(err => {
      console.error('Erro ao buscar game no WebSocket:', err);
    });
  } catch (err) {
    console.error('Erro na conexão WebSocket:', err);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
