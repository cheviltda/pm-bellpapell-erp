# P&M Bellpapell ERP V5

## O que mudou
- PostgreSQL em vez de banco local
- Login JWT
- Senhas com bcrypt
- Perfis `admin` e `operador`
- Clientes
- Acervo
- Kits
- Reservas com bloqueio por conflito de estoque
- Agenda
- Financeiro com lançamentos de pagamento
- Contratos
- Usuários e permissões básicas
- API REST
- Estrutura preparada para hospedagem online

## Rodar
Requisitos: Node.js 20+ e PostgreSQL.

1. `npm install`
2. Crie um banco PostgreSQL vazio.
3. Configure:
   `DATABASE_URL=...`
   `JWT_SECRET=...`
4. `npm start`
5. Abra `http://localhost:3000`

Login inicial:
- e-mail: `admin@bellpapell.local`
- senha: `troque123`

Troque a senha imediatamente e não publique a chave JWT padrão.

## Publicação
Esta versão está preparada para hospedagem, mas ainda precisa ser implantada em um serviço de nuvem. Não há servidor público criado automaticamente por este arquivo.

## Próximas evoluções
- assinatura digital real
- contrato editável com cláusulas da P&M
- upload de fotos do acervo
- manutenção/danos
- check-in/check-out da retirada e devolução
- WhatsApp
- recuperação de senha
- backup automático
- auditoria de alterações
- painel financeiro completo
