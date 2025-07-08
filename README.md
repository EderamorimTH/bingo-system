# Sistema de Sorteio de Bingo

Sistema web dinâmico para sorteio de bingo com exibição em tempo real.

## Configuração
1. **MongoDB Atlas**:
   - Crie uma conta em [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
   - Crie um cluster gratuito e um banco de dados `bingo` com uma coleção `game`.
   - Copie a string de conexão (ex.: `mongodb+srv://<user>:<password>@cluster0.mongodb.net/bingo?retryWrites=true&w=majority`).

2. **Hospedagem no Render**:
   - Crie um repositório no GitHub com todos os arquivos.
   - Acesse [Render](https://render.com/) e crie um novo "Web Service".
   - Conecte ao repositório GitHub.
   - Configure a variável de ambiente `MONGODB_URI` com a string de conexão do MongoDB.
   - Defina o comando de inicialização como `npm start`.
   - Após o deploy, acesse as URLs:
     - `https://seu-bingo.render.com/admin` (painel de sorteio)
     - `https://seu-bingo.render.com/display` (exibição pública)

## Uso
- Na página `/admin`, clique em "Sortear Número" para sortear um número de 1 a 75.
- Atualize o campo "Jogadores próximos de ganhar" e clique em "Atualizar" para enviar a informação.
- A página `/display` mostra os números sorteados e o status do jogo em tempo real.

## Tecnologias
- **Backend**: Node.js, Express, WebSocket (`ws`), MongoDB
- **Frontend**: EJS, Tailwind CSS
- **Atualização em Tempo Real**: WebSocket
