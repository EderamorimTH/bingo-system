// Função para sortear número (automático)
async function drawNumber() {
  const game = await Game.findOne() || new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' });
  const availableNumbers = Array.from({ length: 75 }, (_, i) => i + 1)
    .filter(n => !game.drawnNumbers.includes(n));
  if (availableNumbers.length === 0) return null;
  const newNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
  game.drawnNumbers.push(newNumber);
  game.lastNumber = newNumber;
  await game.save();
  
  const cartelas = await Cartela.find();
  const winners = [];
  for (const cartela of cartelas) {
    if (cartela.numbers.flat().includes(newNumber)) {
      cartela.markedNumbers.push(newNumber);
      if (checkWin(cartela)) {
        winners.push(cartela.cartelaId);
        await new Winner({
          cartelaId: cartela.cartelaId,
          playerName: cartela.playerName,
          createdAt: new Date()
        }).save();
      }
      await cartela.save();
    }
  }
  
  // Buscar cartelas atualizadas para enviar ao frontend
  const updatedCartelas = await Cartela.find();
  return { newNumber, winners, cartelas: updatedCartelas };
}

// Função para marcar número manualmente
async function markNumber(number) {
  if (!Number.isInteger(number) || number < 1 || number > 75) {
    return { error: 'Número inválido (deve ser entre 1 e 75)' };
  }
  const game = await Game.findOne() || new Game({ drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' });
  if (game.drawnNumbers.includes(number)) {
    return { error: 'Número já sorteado' };
  }
  game.drawnNumbers.push(number);
  game.lastNumber = number;
  await game.save();
  
  const cartelas = await Cartela.find();
  const winners = [];
  for (const cartela of cartelas) {
    if (cartela.numbers.flat().includes(number)) {
      cartela.markedNumbers.push(number);
      if (checkWin(cartela)) {
        winners.push(cartela.cartelaId);
        await new Winner({
          cartelaId: cartela.cartelaId,
          playerName: cartela.playerName,
          createdAt: new Date()
        }).save();
      }
      await cartela.save();
    }
  }
  
  // Buscar cartelas atualizadas para enviar ao frontend
  const updatedCartelas = await Cartela.find();
  return { newNumber: number, winners, cartelas: updatedCartelas };
}

// Atualizar endpoint /draw
app.post('/draw', isAuthenticated, async (req, res) => {
  try {
    const result = await drawNumber();
    if (result && result.newNumber) {
      const game = await Game.findOne();
      const { newNumber, winners, cartelas } = result;
      console.log(`Número sorteado automaticamente: ${newNumber}, Vencedores: ${winners}`);
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'update', game, winners, cartelas }));
          console.log('Enviado update WebSocket para sorteio automático:', JSON.stringify({ type: 'update', game, winners, cartelas }));
        }
      });
      res.json({ number: newNumber, winners });
    } else {
      res.status(400).json({ error: 'Não há mais números para sortear' });
    }
  } catch (err) {
    console.error('Erro na rota /draw:', err);
    res.status(500).json({ error: 'Erro ao sortear número' });
  }
});

// Atualizar endpoint /mark-number
app.post('/mark-number', isAuthenticated, async (req, res) => {
  const { number, password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  try {
    const result = await markNumber(parseInt(number));
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    const game = await Game.findOne();
    const { newNumber, winners, cartelas } = result;
    console.log(`Número marcado manualmente: ${newNumber}, Vencedores: ${winners}`);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', game, winners, cartelas }));
        console.log('Enviado update WebSocket para marcação manual:', JSON.stringify({ type: 'update', game, winners, cartelas }));
      }
    });
    res.json({ number: newNumber, winners });
  } catch (err) {
    console.error('Erro na rota /mark-number:', err);
    res.status(500).json({ error: 'Erro ao marcar número' });
  }
});

// Atualizar conexão WebSocket
wss.on('connection', ws => {
  console.log('Novo cliente WebSocket conectado');
  Game.findOne().then(game => {
    Cartela.find().then(cartelas => {
      const data = JSON.stringify({ type: 'update', game: game || { drawnNumbers: [], lastNumber: null, currentPrize: '', additionalInfo: '', startMessage: 'Em Breve o Bingo Irá Começar' }, winners: [], cartelas });
      ws.send(data);
      console.log('Enviado estado inicial WebSocket:', data);
    });
  }).catch(err => {
    console.error('Erro ao inicializar WebSocket:', err);
  });
  ws.on('error', err => {
    console.error('Erro no WebSocket:', err);
  });
  ws.on('close', () => {
    console.log('Cliente WebSocket desconectado');
  });
});
