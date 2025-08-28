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

// EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static (garante MIME correto e serve /public)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => { if (p.endsWith('.css')) res.setHeader('Content-Type', 'text/css'); }
}));

// Compat: se alguém chamar /css/style.css, serve o mesmo arquivo que /styles.css
app.get('/css/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'styles.css'));
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Sem cache
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Mongoose
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
  createdAt: { type: Date, default: Date.now }
});
const Winner = mongoose.model('Winner', winnerSchema);

// Conexão MongoDB + boot inicial
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Conectado ao MongoDB');

    let game = await Game.findOne();
    if (!game) {
      await new Game({
        drawnNumbers: [],
        lastNumber: null,
        currentPrize: '',
        startMessage: 'Em breve o Bingo irá começar'
      }).save();
      console.log('Jogo inicial criado');
    }

    // Gera 500 cartelas fixas só se não existir
    const totalFixas = await Cartela.countDocuments({ playerName: 'FIXAS' });
    if (totalFixas === 0) {
      console.log('Gerando 500 cartelas fixas...');
      for (let i = 1; i <= 500; i++) {
        const numbers = generateCartelaNumbers();
        await new Cartela({
          cartelaId: `FIXA-${i}`,
          numbers,
          playerName: 'FIXAS',
          markedNumbers: [],
          createdAt: new Date()
        }).save();
      }
      console.log('500 cartelas fixas geradas');
    }
  })
  .catch(err => console.error('Erro ao conectar ao MongoDB:', err.message, err.stack));

// Auth middleware
function isAuthenticated(req, res, next) {
  try {
    if (req.cookies.auth === 'true') return next();
    res.redirect('/login');
  } catch (e) {
    console.error('Erro auth:', e.message);
    res.status(500).send('Erro interno no servidor');
  }
}

// Util: gera números de cartela
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
      if (col === 2 && row === 2) column.push(0);
      else column.push(available.splice(Math.floor(Math.random() * available.length), 1)[0]);
    }
    numbers.push(column);
  }
  return numbers;
}

function getNumberLetter(n) {
  if (!n) return '';
  if (n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  if (n <= 75) return 'O';
  return '';
}

function checkWin(cartela) {
  const marked = cartela.markedNumbers || [];
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 5; r++) {
      const num = cartela.numbers[c][r];
      if (num !== 0 && !marked.includes(num)) return false;
    }
  }
  return true;
}

// Broadcast para todos os clientes
async function broadcastGameAndWinners() {
  try {
    const game = await Game.findOne();
    const winners = await Winner.find().sort({ createdAt: 1 }); // ordem cronológica
    const payload = JSON.stringify({
      type: 'update',
      game: {
        drawnNumbers: game?.drawnNumbers || [],
        lastNumber: game?.lastNumber || null,
        currentPrize: game?.currentPrize || '',
        startMessage: game?.startMessage || 'Em breve o Bingo irá começar',
        lastNumberDisplay: game?.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      winners: winners.map(w => ({
        cartelaId: w.cartelaId,
        playerName: w.playerName,
        phoneNumber: w.phoneNumber,
        link: w.link,
        prize: w.prize,
        createdAt: w.createdAt
      }))
    });

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  } catch (e) {
    console.error('Erro no broadcast:', e.message, e.stack);
  }
}

// Marca número em todas as cartelas e registra novos vencedores (sem duplicar)
async function applyNumberAndCollectWinners(number) {
  const game = await Game.findOne();
  const cartelas = await Cartela.find({ playerName: { $ne: 'FIXAS' } });

  const newWinners = [];
  for (const cartela of cartelas) {
    const temNumero = cartela.numbers.flat().includes(number);
    if (temNumero && !cartela.markedNumbers.includes(number)) {
      cartela.markedNumbers.push(number);
      // Se esta cartela fechou, e ainda não existe Winner para ela, cria
      if (checkWin(cartela)) {
        const jaExiste = await Winner.exists({ cartelaId: cartela.cartelaId });
        if (!jaExiste) {
          const player = await Player.findOne({ playerName: cartela.playerName });
          const winnerDoc = await new Winner({
            cartelaId: cartela.cartelaId,
            playerName: cartela.playerName,
            phoneNumber: player ? player.phoneNumber : '',
            link: player ? player.link : '',
            prize: game?.currentPrize || 'Não especificado',
            createdAt: new Date()
          }).save();
          newWinners.push(winnerDoc);
        }
      }
      await cartela.save();
    }
  }
  return newWinners;
}

// Sorteio automático
async function drawNumber() {
  const game = await Game.findOne();
  if (!game) return { error: 'Jogo não encontrado' };
  const available = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !game.drawnNumbers.includes(n));
  if (!available.length) return { error: 'Não há mais números para sortear' };

  const newNumber = available[Math.floor(Math.random() * available.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();

  const winners = await applyNumberAndCollectWinners(newNumber);
  return { newNumber, winners };
}

// Marcação manual
async function markNumber(number) {
  number = parseInt(number, 10);
  if (!Number.isInteger(number) || number < 1 || number > 75) return { error: 'Número inválido' };

  const game = await Game.findOne();
  if (!game) return { error: 'Jogo não encontrado' };
  if (game.drawnNumbers.includes(number)) return { error: 'Número já sorteado' };

  game.drawnNumbers.push(number);
  game.lastNumber = number;
  await game.save();

  const winners = await applyNumberAndCollectWinners(number);
  return { newNumber: number, winners };
}

// Rotas
app.get('/', (req, res) => res.redirect('/display'));

app.get('/login', (req, res) => {
  try { res.render('login', { error: null }); }
  catch { res.status(500).send('Erro ao carregar a página de login'); }
});

app.post('/login', (req, res) => {
  try {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
      res.cookie('auth', 'true', { httpOnly: true });
      res.redirect('/admin');
    } else res.render('login', { error: 'Senha incorreta' });
  } catch (e) {
    console.error('Erro login:', e.message);
    res.status(500).send('Erro interno no servidor');
  }
});

app.get('/admin', isAuthenticated, async (req, res) => {
  try {
    if (Object.keys(req.query).length > 0) return res.redirect('/admin');

    let game = await Game.findOne();
    if (!game) {
      game = await new Game({
        drawnNumbers: [],
        lastNumber: null,
        currentPrize: '',
        startMessage: 'Em breve o Bingo irá começar'
      }).save();
    }

    const players = await Player.find().sort({ createdAt: -1 }) || [];
    const winners = await Winner.find().sort({ createdAt: -1 }) || [];
    res.render('admin', {
      players,
      winners,
      game: {
        drawnNumbers: game.drawnNumbers || [],
        lastNumber: game.lastNumber,
        currentPrize: game.currentPrize || '',
        startMessage: game.startMessage || 'Em breve o Bingo irá começar',
        lastNumberDisplay: game.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      error: null
    });
  } catch (e) {
    console.error('Erro render admin:', e.message, e.stack);
    res.status(500).render('admin', {
      players: [],
      winners: [],
      game: {
        drawnNumbers: [],
        lastNumber: null,
        currentPrize: '',
        startMessage: 'Erro ao carregar dados',
        lastNumberDisplay: '--'
      },
      error: 'Erro ao carregar o painel de administração.'
    });
  }
});

app.get('/admin/data', isAuthenticated, async (req, res) => {
  try {
    const players = await Player.find().sort({ createdAt: -1 }) || [];
    const winners = await Winner.find().sort({ createdAt: -1 }) || [];
    res.json({ players, winners });
  } catch (e) {
    console.error('Erro /admin/data:', e.message);
    res.status(500).json({ error: 'Erro ao carregar dados' });
  }
});

// NOVO: endpoint de estado do jogo (usado no display/sorteador/cartelas)
app.get('/game', async (req, res) => {
  try {
    const game = await Game.findOne();
    res.json({
      drawnNumbers: game?.drawnNumbers || [],
      lastNumber: game?.lastNumber || null,
      currentPrize: game?.currentPrize || '',
      startMessage: game?.startMessage || 'Em breve o Bingo irá começar',
      lastNumberDisplay: game?.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
    });
  } catch (e) {
    console.error('Erro /game:', e.message);
    res.status(500).json({ error: 'Erro ao carregar game' });
  }
});

// NOVO: endpoint para obter todos os vencedores (usado no sorteador)
app.get('/winners', async (req, res) => {
  try {
    const winners = await Winner.find().sort({ createdAt: 1 });
    res.json(winners.map(w => ({
      cartelaId: w.cartelaId,
      playerName: w.playerName,
      phoneNumber: w.phoneNumber,
      link: w.link,
      prize: w.prize,
      createdAt: w.createdAt
    })));
  } catch (e) {
    console.error('Erro /winners:', e.message);
    res.status(500).json({ error: 'Erro ao carregar vencedores' });
  }
});

app.get('/display', async (req, res) => {
  try {
    const game = await Game.findOne();
    const winners = await Winner.find().sort({ createdAt: 1 }) || [];
    res.render('display', {
      game: {
        drawnNumbers: game?.drawnNumbers || [],
        lastNumber: game?.lastNumber || null,
        currentPrize: game?.currentPrize || '',
        startMessage: game?.startMessage || 'Em breve o Bingo irá começar',
        lastNumberDisplay: game?.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      winners
    });
  } catch {
    res.status(500).send('Erro ao carregar a página de exibição');
  }
});

app.get('/sorteador', async (req, res) => {
  try {
    const game = await Game.findOne();
    const winners = await Winner.find().sort({ createdAt: 1 }) || [];
    res.render('sorteador', {
      game: {
        drawnNumbers: game?.drawnNumbers || [],
        lastNumber: game?.lastNumber || null,
        currentPrize: game?.currentPrize || '',
        startMessage: game?.startMessage || 'Em breve o Bingo irá começar',
        lastNumberDisplay: game?.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      winners
    });
  } catch {
    res.status(500).send('Erro ao carregar a página do sorteador');
  }
});

app.get('/cartelas', async (req, res) => {
  try {
    const { playerName } = req.query;
    if (!playerName) return res.status(400).send('Nome do jogador é obrigatório');
    const cartelas = await Cartela.find({ playerName });
    if (cartelas.length === 0) return res.status(404).send('Nenhuma cartela encontrada');

    const game = await Game.findOne();
    const winners = await Winner.find().sort({ createdAt: 1 }) || [];
    res.render('cartelas', {
      cartelas,
      playerName,
      game: {
        drawnNumbers: game?.drawnNumbers || [],
        lastNumber: game?.lastNumber || null,
        currentPrize: game?.currentPrize || '',
        startMessage: game?.startMessage || 'Em breve o Bingo irá começar',
        lastNumberDisplay: game?.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      winners
    });
  } catch (e) {
    console.error('Erro /cartelas:', e.message);
    res.status(500).send('Erro ao carregar a página de cartelas');
  }
});

app.get('/cartelas-fixas', async (req, res) => {
  try {
    const cartelas = await Cartela.find({ playerName: 'FIXAS' });
    const game = await Game.findOne();
    res.render('cartelas', {
      cartelas,
      playerName: 'Cartelas Fixas',
      game: {
        drawnNumbers: game?.drawnNumbers || [],
        lastNumber: game?.lastNumber || null,
        currentPrize: game?.currentPrize || '',
        startMessage: game?.startMessage || 'Em breve o Bingo irá começar',
        lastNumberDisplay: game?.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      winners: []
    });
  } catch (e) {
    console.error('Erro /cartelas-fixas:', e.message);
    res.status(500).send('Erro ao carregar a página de cartelas fixas');
  }
});

// Ações
app.post('/draw', isAuthenticated, async (req, res) => {
  try {
    const result = await drawNumber();
    if (result.error) return res.status(400).json({ error: result.error });
    await broadcastGameAndWinners();
    res.json({ number: result.newNumber, winners: result.winners });
  } catch (e) {
    console.error('Erro /draw:', e.message);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/mark-number', isAuthenticated, async (req, res) => {
  try {
    const { number, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });

    const result = await markNumber(number);
    if (result.error) return res.status(400).json({ error: result.error });
    await broadcastGameAndWinners();
    res.json({ number: result.newNumber, winners: result.winners });
  } catch (e) {
    console.error('Erro /mark-number:', e.message);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/update-prize', isAuthenticated, async (req, res) => {
  try {
    const { currentPrize } = req.body;
    let game = await Game.findOne();
    if (!game) {
      await new Game({
        drawnNumbers: [],
        lastNumber: null,
        currentPrize,
        startMessage: 'Em breve o Bingo irá começar'
      }).save();
    } else {
      game.currentPrize = currentPrize;
      await game.save();
    }
    await broadcastGameAndWinners();
    res.json({ success: true });
  } catch (e) {
    console.error('Erro /update-prize:', e.message);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// IMPORTANTE: reset NÃO apaga vencedores (persistem para seu histórico)
app.post('/reset', isAuthenticated, async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });

    await Game.deleteMany({});
    await Cartela.updateMany({}, { markedNumbers: [] });
    await new Game({
      drawnNumbers: [],
      lastNumber: null,
      currentPrize: '',
      startMessage: 'Em breve o Bingo irá começar'
    }).save();

    await broadcastGameAndWinners();
    res.json({ success: true });
  } catch (e) {
    console.error('Erro /reset:', e.message);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/delete-all', isAuthenticated, async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });

    await Player.deleteMany({});
    await Cartela.updateMany({ playerName: { $ne: 'FIXAS' } }, { playerName: 'FIXAS', markedNumbers: [] });

    await broadcastGameAndWinners();
    res.json({ success: true });
  } catch (e) {
    console.error('Erro /delete-all:', e.message);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/delete-by-phone', isAuthenticated, async (req, res) => {
  try {
    const { password, phoneNumber } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });

    const player = await Player.findOne({ phoneNumber });
    if (!player) return res.status(404).json({ error: 'Jogador não encontrado' });

    await Cartela.updateMany({ playerName: player.playerName }, { playerName: 'FIXAS', markedNumbers: [] });
    await player.deleteOne();

    await broadcastGameAndWinners();
    res.json({ success: true });
  } catch (e) {
    console.error('Erro /delete-by-phone:', e.message);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// WebSocket
wss.on('connection', async (ws) => {
  try {
    const game = await Game.findOne();
    const winners = await Winner.find().sort({ createdAt: 1 });
    ws.send(JSON.stringify({
      type: 'update',
      game: {
        drawnNumbers: game?.drawnNumbers || [],
        lastNumber: game?.lastNumber || null,
        currentPrize: game?.currentPrize || '',
        startMessage: game?.startMessage || 'Em breve o Bingo irá começar',
        lastNumberDisplay: game?.lastNumber ? `${getNumberLetter(game.lastNumber)}-${game.lastNumber}` : '--'
      },
      winners: winners.map(w => ({
        cartelaId: w.cartelaId,
        playerName: w.playerName,
        phoneNumber: w.phoneNumber,
        link: w.link,
        prize: w.prize,
        createdAt: w.createdAt
      }))
    }));
  } catch (e) {
    console.error('Erro WS connection:', e.message, e.stack);
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
