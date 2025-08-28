const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const bodyParser = require("body-parser");

// Mongoose
const mongoose = require("mongoose");

// Conexão MongoDB (usar variável de ambiente no Render)
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/bingo";

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ MongoDB conectado"))
    .catch(err => console.error("❌ Erro MongoDB:", err));

// Schemas simples
const cartelaSchema = new mongoose.Schema({
    id: Number,
    dono: String,
    telefone: String,
    numeros: [Number],
    premio: String
});

const Cartela = mongoose.model("Cartela", cartelaSchema);

async function start() {
    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server);

    let numerosSorteados = [];
    let ultimosNumeros = [];
    let premioAtual = "";
    let vencedores = [];

    // Configuração EJS e estáticos
    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "views"));
    app.use(express.static(path.join(__dirname, "public")));
    app.use(bodyParser.urlencoded({ extended: true }));

    // ================= ROTAS =================

    // Painel Admin
    app.get("/admin", async (req, res) => {
        const cartelas = await Cartela.find();
        res.render("admin", { numerosSorteados, ultimosNumeros, premioAtual, vencedores, cartelas });
    });

    // Sortear número automático
    app.post("/sortear", (req, res) => {
        if (numerosSorteados.length >= 75) {
            return res.send("Todos os números já foram sorteados!");
        }

        let numero;
        do {
            numero = Math.floor(Math.random() * 75) + 1;
        } while (numerosSorteados.includes(numero));

        numerosSorteados.push(numero);
        ultimosNumeros.unshift(numero);
        if (ultimosNumeros.length > 5) ultimosNumeros.pop();

        io.emit("numeroSorteado", { numero, ultimosNumeros });
        res.redirect("/admin");
    });

    // Atualizar prêmio
    app.post("/premio", (req, res) => {
        premioAtual = req.body.premio;
        io.emit("premioAtualizado", premioAtual);
        res.redirect("/admin");
    });

    // Atribuir cartela
    app.post("/atribuir", async (req, res) => {
        const { id, nome, telefone } = req.body;
        const cartela = await Cartela.findOne({ id: parseInt(id) });
        if (cartela) {
            cartela.dono = nome;
            cartela.telefone = telefone;
            await cartela.save();
        }
        res.redirect("/admin");
    });

    // Reiniciar bingo
    app.post("/reiniciar", async (req, res) => {
        numerosSorteados = [];
        ultimosNumeros = [];
        vencedores = [];
        premioAtual = "";
        await Cartela.updateMany({}, { dono: "", telefone: "", premio: "" });
        io.emit("reiniciar");
        res.redirect("/admin");
    });

    // Página cartela individual
    app.get("/cartela/:id", async (req, res) => {
        const cartela = await Cartela.findOne({ id: parseInt(req.params.id) });
        if (!cartela) return res.send("❌ Cartela não encontrada!");
        res.render("cartelas", { cartela });
    });

    // ================= SOCKET =================
    io.on("connection", socket => {
        console.log("Novo cliente conectado");
    });

    // ================= GERAR 500 CARTELAS FIXAS =================
    const totalCartelas = await Cartela.countDocuments();
    if (totalCartelas === 0) {
        let id = 1;
        while (id <= 500) {
            const numeros = [];
            while (numeros.length < 15) {
                const n = Math.floor(Math.random() * 75) + 1;
                if (!numeros.includes(n)) numeros.push(n);
            }
            await Cartela.create({ id, dono: "", telefone: "", numeros, premio: "" });
            id++;
        }
        console.log("✅ 500 cartelas fixas geradas");
    }

    // ================= START SERVER =================
    const PORT = process.env.PORT || 10000;
    server.listen(PORT, () => console.log(`🚀 Servidor rodando em http://localhost:${PORT}`));
}

// Inicia função async
start().catch(err => console.error(err));
