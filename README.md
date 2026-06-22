# Auditoria CRECI/PR x SCIRE

Aplicativo web **100% frontend** para auditoria técnica, contratual, operacional e financeira de demandas entre CRECI/PR e SCIRE.

## O que mudou nesta versão

- sem login
- sem backend
- sem banco de dados no servidor
- pronto para publicar no **Vercel grátis**
- histórico salvo localmente no navegador
- exportação de snapshot em `JSON` para backup e transporte entre máquinas

## Funcionalidades

- Upload por quatro seções independentes
- Leitura de `PDF`, `XLS`, `XLSX`, `CSV` e `DOCX`
- OCR automático para PDFs escaneados com baixa extração textual
- Tabela editável de redefinições administrativas de CPF
- Cruzamento entre bases CRECI/PR, SCIRE e documentos contratuais
- Classificação contratual automática
- Cálculo de valor cobrado, valor devido, valor glosável e valor simulado
- Painel gerencial com cards e gráficos
- Tabela analítica com filtros
- Relatório técnico consolidado
- Exportação para `Excel`, `PDF` e snapshot `JSON`
- Reprocessamento completo após troca de arquivos
- Histórico local salvo no navegador

## Como executar

```bash
npm install
npm run dev
```

Ambiente local:

- app: `http://localhost:4173`

## Build de produção

```bash
npm run build
npm run preview
```

Artefato final:

- `dist/`

## Publicar no Vercel

Esse projeto está pronto para Vercel porque é um app estático em Vite.

### Passos

1. envie o projeto para o GitHub
2. entre em [Vercel](https://vercel.com)
3. clique em **Add New Project**
4. importe o repositório
5. confirme:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
6. publique

## Como os dados ficam salvos

Nesta versão:

- os arquivos são processados no navegador
- o histórico de análises fica salvo no **localStorage** do navegador
- snapshots podem ser exportados em `JSON`

## Importante sobre histórico

Como não há backend:

- se você limpar os dados do navegador, o histórico local pode ser perdido
- se trocar de computador, leve o snapshot `JSON`
- para maior segurança, exporte snapshots das análises importantes

## Observações

- Arquivos `.doc` legados são aceitos para registro, mas a leitura textual no navegador é limitada. Prefira converter para `DOCX` ou `PDF`.
- PDFs escaneados ou com texto não selecionável acionam OCR automaticamente no navegador. Esse processo pode demorar mais em arquivos grandes.
- A análise é heurística e conservadora: resultados pendentes devem ser validados administrativamente quando faltarem evidências.