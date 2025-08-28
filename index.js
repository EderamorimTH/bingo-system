const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const path = require('path');
const cookieParser = require('cookie-parser');
const ExcelJS = require('exceljs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configurar EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => {
    if (p.endsWith('.css')) {
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

// Rotas principais
app.get('/', (req, res) => res.redirect('/display'));

// ... [MANTIVE TODAS AS SUAS OUTRAS ROTAS IGUAIS]

// Endpoint atualizado para baixar cartelas 5x5
app.get('/download-cartelas', isAuthenticated, async (req, res) => {
  try {
    const cartelas = await Cartela.find({ playerName: "FIXAS" }).sort({ cartelaId: 1 });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Cartelas - 5x5');

    sheet.columns = [
      { header: 'Cartela ID', key: 'cartelaId', width: 14 },
      { header: 'B', key: 'c1', width: 8 },
      { header: 'I', key: 'c2', width: 8 },
      { header: 'N', key: 'c3', width: 8 },
      { header: 'G', key: 'c4', width: 8 },
      { header: 'O', key: 'c5', width: 8 }
    ];

    sheet.getRow(1).font = { bold: true };

    let currentRow = 1;

    cartelas.forEach((c) => {
      currentRow++;
      const headerRow = sheet.getRow(currentRow);
      headerRow.getCell(1).value = `Cartela ID: ${c.cartelaId}`;
      headerRow.getCell(1).font = { bold: true };
      sheet.mergeCells(currentRow, 1, currentRow, 6);

      currentRow++;
      const titlesRow = sheet.getRow(currentRow);
      titlesRow.getCell(2).value = 'B';
      titlesRow.getCell(3).value = 'I';
      titlesRow.getCell(4).value = 'N';
      titlesRow.getCell(5).value = 'G';
      titlesRow.getCell(6).value = 'O';
      titlesRow.font = { bold: true };
      titlesRow.alignment = { horizontal: 'center' };

      for (let row = 0; row < 5; row++) {
        currentRow++;
        const excelRow = sheet.getRow(currentRow);

        const b = c.numbers?.[0]?.[row] ?? '';
        const i = c.numbers?.[1]?.[row] ?? '';
        const n = c.numbers?.[2]?.[row] ?? '';
        const g = c.numbers?.[3]?.[row] ?? '';
        const o = c.numbers?.[4]?.[row] ?? '';

        excelRow.getCell(2).value = b === 0 ? 'X' : b;
        excelRow.getCell(3).value = i === 0 ? 'X' : i;
        excelRow.getCell(4).value = n === 0 ? 'X' : n;
        excelRow.getCell(5).value = g === 0 ? 'X' : g;
        excelRow.getCell(6).value = o === 0 ? 'X' : o;

        for (let col = 2; col <= 6; col++) {
          excelRow.getCell(col).alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }

      currentRow++;
      sheet.addRow([]);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="cartelas_5x5.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Erro ao gerar Excel (5x5):', err.message, err.stack);
    res.status(500).send('Erro ao gerar cartelas');
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
