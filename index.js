const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("view engine", "ejs");
app.set("views", __dirname + "/views");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    secret: "bingo-secret",
    resave: false,
    saveUninitialized: true,
  })
);

// ====== MongoDB Models ======
mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/bingo", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Conectado ao MongoDB"))
  .catch((err) => console.error("Erro MongoDB:", err));

const cartelaSchema = new mongoose.Schema({
  cartelaId: Number,
  numeros: [Number],
  dono: String,
  telefone: String,
});

const gameSchema = new mongoose.Schema({
  lastNumber: Number,
  drawnNumbers: [Number],
  currentPrize: String,
});

const Cartela = mongoose.model("Cartela", cartelaSchema);
const Game = mongoose.model("Game", gameSchema);

// ====== Estado do jogo ======
let game = {
  lastNumber: null,
  drawnNumbers: [],
  currentPrize: "",
};

// Carregar estado inicial
(async () => {
  const savedGame = await Game.findOne();
  if (savedGame) {
    game = savedGame.toObject();
  } else {
    await Game.create(game);
  }
})();

// ====== Rotas ======
app.get("/", (req, res) => {
  res.send("Servidor Bingo rodando 🚀");
});

// Painel do Admin
app.get("/admin", async (req, res) => {
  const players = await Cartela.aggregate([
    {
      $group: {
        _id: "$dono",
        telefone: { $first: "$telefone" },
        cartelas: { $push: "$cartelaId" },
      },
    },
  ]);
  res.render("admin", { game, players });
});

// Cartelas por jogador
app.get("/cartelas", async (req, res) => {
  try {
    const { playerName } = req.query;
    if (!playerName) return res.status(400).send("Jogador não especificado");

    const cartelas = await Cartela.find({ dono: playerName });
    if (!cartelas || cartelas.length === 0) {
      return res.status(404).send("Nenhuma cartela encontrada para este jogador");
    }

    res.render("cartelas", {
      playerName,
      phoneNumber: cartelas[0].telefone,
      cartelas,
      game,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao carregar cartelas");
  }
});

// Display público
app.get("/display", (req, res) => {
  res.render("display", { game });
});

// Sorteador
app.get("/sorteador", (req, res) => {
  res.render("sorteador", { game });
});

// ====== Ações do jogo ======

// Sortear número
app.post("/sortear", async (req, res) => {
  const { numero } = req.body;
  let num;

  if (numero) {
    num = parseInt(numero);
    if (isNaN(num) || num < 1 || num > 75) {
      return res.status(400).send("Número inválido");
    }
  } else {
    const disponiveis = Array.from({ length: 75 }, (_, i) => i + 1).filter(
      (n) => !game.drawnNumbers.includes(n)
    );
    if (disponiveis.length === 0) {
      return res.status(400).send("Todos os números já foram sorteados");
    }
    num = disponiveis[Math.floor(Math.random() * disponiveis.length)];
  }

  game.lastNumber = num;
  game.drawnNumbers.push(num);
  await Game.updateOne({}, game, { upsert: true });

  io.emit("updateGame", game);
  res.redirect("/sorteador");
});

// Atualizar prêmio atual
app.post("/premio", async (req, res) => {
  game.currentPrize = req.body.premio;
  await Game.updateOne({}, game, { upsert: true });

  io.emit("updateGame", game);
  res.redirect("/admin");
});

// Resetar jogo
app.post("/reset", async (req, res) => {
  game = { lastNumber: null, drawnNumbers: [], currentPrize: "" };
  await Game.deleteMany({});
  await Game.create(game);

  io.emit("updateGame", game);
  res.redirect("/admin");
});

// Atribuir cartela
app.post("/atribuir", async (req, res) => {
  const { cartelaId, dono, telefone } = req.body;
  const cartela = await Cartela.findOne({ cartelaId });

  if (!cartela) return res.status(404).send("Cartela não encontrada");
  if (cartela.dono) {
    return res
      .status(400)
      .send(`Cartela já atribuída para ${cartela.dono}`);
  }

  cartela.dono = dono;
  cartela.telefone = telefone;
  await cartela.save();

  io.emit("updateGame", game);
  res.redirect("/admin");
});

// ====== Socket.IO ======
io.on("connection", (socket) => {
  console.log("Novo cliente conectado");
  socket.emit("updateGame", game);

  socket.on("disconnect", () => {
    console.log("Cliente desconectado");
  });
});

// ====== Servidor ======
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
