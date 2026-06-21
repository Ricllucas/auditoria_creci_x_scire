# Auditoria CRECI/PR x SCIRE

Aplicativo web full-stack para auditoria técnica, contratual, operacional e financeira de demandas entre CRECI/PR e SCIRE.

## Funcionalidades

- Backend em `Express`
- Login por e-mail e senha
- Banco de dados local com `sql.js`
- Histórico de análises salvo por usuário
- Upload por quatro seções independentes
- Leitura de `PDF`, `XLS`, `XLSX`, `CSV` e `DOCX`
- Tabela editável de redefinições administrativas de CPF
- Cruzamento entre bases CRECI/PR, SCIRE e documentos contratuais
- Classificação contratual automática
- Cálculo de valor cobrado, valor devido, valor glosável e valor simulado
- Painel gerencial com cards e gráficos
- Tabela analítica com filtros
- Relatório técnico consolidado
- Exportação para `Excel`, `PDF` e snapshot `JSON`
- Reprocessamento completo após troca de arquivos

## Regras implementadas

- Prevalência da base oficial do CRECI/PR para departamento
- Aplicação prioritária das redefinições administrativas de CPF
- Critério conservador para itens pendentes, mistos, duplicados ou sem comprovação
- Separação entre obrigação contratual, melhoria evolutiva, caso misto, pendência e duplicidade
- Uso do valor/hora contratual identificado nos documentos quando disponível

## Como executar

```bash
npm install
npm run dev
```

Ambiente de desenvolvimento:

- frontend: `http://localhost:4173`
- backend: `http://localhost:8787`

O primeiro usuário cadastrado recebe perfil `admin`.

## Build de produção

```bash
npm run build
npm run start
```

Artefatos gerados:

- frontend: `dist/`
- backend compilado: `server-dist/`
- banco local: `data/app.db`

## Usar em outro computador pela rede local

Se os computadores estiverem na mesma rede:

1. rode o app no computador principal:

```bash
npm install
npm run dev
```

2. descubra o IP da máquina hospedeira;
3. no outro computador, acesse:

```text
http://IP-DA-MAQUINA:4173
```

Exemplo:

```text
http://192.168.0.15:4173
```

Se quiser testar a versão de produção localmente:

```bash
npm run build
npm run start
```

## Publicar na web

Como agora existe backend e banco de dados, o projeto deve ser publicado em um ambiente Node.js, por exemplo:

- VPS Linux/Windows
- Render
- Railway
- Fly.io
- servidor institucional com Node.js

Parâmetros principais:

- comando de build: `npm run build`
- comando de start: `npm run start`
- porta padrão da API/app: `8787`

## Deploy pronto para produção

Arquivos adicionados para deploy real:

- `Dockerfile`
- `render.yaml`
- `.env.example`
- `.dockerignore`

## Variáveis de ambiente de produção

Use estas variáveis:

```bash
NODE_ENV=production
PORT=8787
APP_JWT_SECRET=seu-segredo-forte
APP_DATA_DIR=/var/data/creci-pr-scire
APP_CORS_ORIGIN=
APP_COOKIE_SAMESITE=lax
```

### Significado

- `APP_JWT_SECRET`: obrigatório em produção
- `APP_DATA_DIR`: diretório persistente do banco local
- `APP_CORS_ORIGIN`: necessário apenas se frontend e backend ficarem em domínios diferentes
- `APP_COOKIE_SAMESITE`: normalmente `lax`; use `none` somente em cenário cross-domain com HTTPS

## Deploy na Render

Este projeto já está preparado com `render.yaml`.

### Passos

1. envie o projeto para um repositório GitHub;
2. entre na [Render](https://render.com);
3. escolha **New +** → **Blueprint**;
4. selecione o repositório;
5. confirme a criação do serviço;
6. após o deploy, abra a URL pública gerada pela Render.

### Observações da Render

- o banco local fica salvo em disco persistente;
- o frontend é servido pelo próprio backend Express;
- a rota de saúde é `GET /api/health`.

## Deploy com Docker

Build da imagem:

```bash
docker build -t creci-pr-scire .
```

Execução local:

```bash
docker run -d ^
  -p 8787:8787 ^
  -e NODE_ENV=production ^
  -e APP_JWT_SECRET=troque-esta-chave ^
  -e APP_DATA_DIR=/app/data ^
  -v creci_scire_data:/app/data ^
  --name creci-pr-scire ^
  creci-pr-scire
```

Depois acesse:

```text
http://localhost:8787
```

## Deploy em VPS

Em um servidor Linux com Node 22:

```bash
npm install
npm run build
APP_JWT_SECRET=seu-segredo NODE_ENV=production npm run start
```

Recomenda-se executar atrás de:

- Nginx
- Caddy
- Traefik

com HTTPS habilitado.

## Estrutura full-stack incluída

- `server/index.ts`: API HTTP e autenticação
- `server/db.ts`: inicialização e persistência do banco
- `server/repositories.ts`: acesso a usuários e análises
- `src/services/api.ts`: cliente HTTP do frontend
- `src/components/auth/AuthPanel.tsx`: tela de login/cadastro
- `src/components/SavedAnalysesPanel.tsx`: histórico salvo

## Segurança e persistência

- Sessão baseada em cookie HTTP-only
- Senhas com hash via `bcryptjs`
- Token JWT para autenticação
- Banco salvo localmente em `data/app.db`

## Observação importante sobre privacidade

O processamento principal dos arquivos continua ocorrendo no navegador do usuário. Nesta versão:

- os arquivos são processados localmente no browser;
- o backend é usado para autenticação e persistência;
- as análises consolidadas podem ser salvas no banco sem depender de planilhas externas.

## Próximas evoluções recomendadas

- histórico de análises;
- armazenamento centralizado de arquivos;
- OCR de PDFs escaneados;
- trilha de auditoria e perfis de acesso.

## Observações

- Arquivos `.doc` legados são aceitos para registro, mas a leitura textual no navegador é limitada. Prefira converter para `DOCX` ou `PDF`.
- PDFs somente imagem podem gerar alertas de baixa extração textual.
- A análise é heurística e conservadora: resultados pendentes devem ser validados administrativamente quando faltarem evidências.