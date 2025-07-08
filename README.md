# Sistema de Sorteio de Bingo

Sistema web dinâmico para sorteio de bingo com exibição em tempo real. O banco de dados e a coleção são criados automaticamente pelo aplicativo.

## Configuração
1. **MongoDB Atlas**:
   - Crie uma conta em [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
   - Crie um cluster gratuito (escolha a região mais próxima, ex.: AWS São Paulo).
   - Em **Database Access**, crie um usuário (ex.: `bingo_user`, com uma senha forte).
   - Em **Network Access**, adicione o IP `0.0.0.0/0` para permitir acesso de qualquer lugar.
   - Copie a string de conexão (ex.: `mongodb+srv://bingo_user:<password>@cluster0.mongodb.net/bingo?retryWrites=true&w=majority`).
   - **Nota**: Não é necessário criar o banco `bingo` ou a coleção `game` manualmente; o aplicativo faz isso automaticamente.

2. **Criar Arquivos no GitHub**:
   - Crie um repositório no GitHub chamado `bingo-system`.
   - Adicione os arquivos listados acima diretamente na interface web do GitHub (clique em **Add file** > **Create new file**).
   - **Não** adicione o arquivo `.env` ao GitHub, pois ele contém dados sensíveis.

3. **Hospedagem no Render**:
   - Acesse [Render](https://render.com/) e crie um novo "Web Service".
   - Conecte ao repositório GitHub `bingo-system`.
   - Configure:
     - **Environment**: Node
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
     - **Environment Variables**: Adicione `MONGODB_URI` com a string de conexão do MongoDB.
   - Clique em **Create Web Service**.
   - Após o deploy, acesse:
     - `https://seu-bingo.render.com/admin` (painel de sorteio)
     - `https://seu-bingo.render.com/display` (exibição pública)

## Uso
- Na página `/admin`, clique em "Sortear Número" para sortear um número de 1 a 75.
- Atualize o campo "Jogadores próximos de ganhar" e clique em "Atualizar".
- A página `/display` mostra os números sorteados e o status do jogo em tempo real.
- O banco de dados `bingo` e a coleção `game` são criados automaticamente na primeira execução.

## Tecnologias
- **Backend**: Node.js, Express, WebSocket (`ws`), MongoDB
- **Frontend**: EJS, Tailwind CSS
- **Atualização em Tempo Real**: WebSocket
