# Barts Barber Shop

Site comercial responsivo em React, TypeScript, Vite e Tailwind CSS, com Supabase Auth, PostgreSQL, RLS e Storage.

## Executar localmente

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no `.env`. Somente variáveis públicas podem usar o prefixo `VITE_`.

## Supabase

1. Instale e autentique o Supabase CLI.
2. Vincule ao projeto correto: `supabase link --project-ref sthjheqafbxkawyieiqd`.
3. Revise as migrations em `supabase/migrations`.
4. Aplique-as com `supabase db push`.
5. Cadastre serviços, profissionais, serviços por profissional e janelas de disponibilidade.
6. Configure os redirects de Auth para o domínio publicado.

A migration `202611240002_security_operations.sql` corrige a migration inicial sem reescrevê-la: limita atualização de perfil, substitui a função antiga de agendamento por uma RPC de UUID, valida vínculo/horário/bloqueio, aplica conflito por profissional e cria políticas/estruturas complementares.

### Criar o primeiro administrador

1. Crie uma conta no Supabase Auth pelo procedimento de provisionamento aprovado.
2. Localize o UUID da conta em **Authentication → Users**.
3. Abra `supabase/operations/create-first-admin.sql`, substitua o UUID de exemplo e execute uma única vez no SQL Editor como operador do projeto.
4. Faça login em `/admin` e confirme que um usuário comum é recusado.

Não execute esse script por meio de uma rota pública ou de um usuário autenticado comum. Alterações de função não são permitidas pelo frontend.

### Agendamentos

- Fuso comercial: `America/Sao_Paulo`.
- `get_booking_slots` retorna horários possíveis com base em disponibilidade, serviços/profissional, reservas e bloqueios.
- `create_public_booking` repete a validação no banco; a constraint GiST impede reservas concorrentes do mesmo profissional e permite profissionais diferentes em paralelo.
- Cadastre janelas de disponibilidade e a relação serviço/profissional; sem esses dados a agenda retorna sem horários.

### Loja e pedidos

O catálogo e as imagens vêm do banco/Storage. O carrinho local guarda apenas IDs e quantidades. `create_customer_order` exige autenticação, recalcula preços do banco, bloqueia linhas de estoque e cria pedido/itens atomicamente.

O pedido permanece `pending` e reserva estoque. Pagamento, expiração/liberação automática de reserva, entrega e histórico do cliente ainda não estão concluídos. Não anuncie pedidos pendentes como pagos.

### Mídia e CMS

O bucket público `barts-public` aceita imagens JPEG, PNG, WebP e AVIF de até 5 MB. Upload e alteração exigem administrador. A tabela `site_content` oferece conteúdo JSON publicado; as chaves `home.hero`, `home.intro` e `contact` são lidas como texto pelo site. Conteúdo é renderizado como texto React, não como HTML executável.

## Painel administrativo

`/admin` usa Supabase Auth e verifica `profiles.role` no banco. Oferece consulta/CRUD para agenda, serviços, profissionais, disponibilidade, vínculo de serviços, catálogo/estoque, imagens de produto, mídia, CMS, configurações e entrega. Clientes, pedidos, pagamentos e histórico do CMS são apresentados como consulta. Alterações em pagamentos e pedidos não são permitidas pelo navegador.

## Validação

```powershell
npm run build
supabase start
supabase db reset
supabase test db
```

As verificações pgTAP em `supabase/tests/security_operations.test.sql` cobrem RLS/permissões, RPCs e a constraint de conflitos. `supabase db reset` e `supabase test db` precisam de Docker local. Foram tentados `supabase db lint --local` e `supabase test db`, mas o daemon Docker está indisponível neste ambiente; os testes de banco foram preparados, mas não executados.

## Pendências para produção

- Aplicar e validar as migrations no projeto Supabase; testar permissões como `anon`, `authenticated`, cliente e admin.
- Provisionar primeiro administrador e usuários de teste.
- Configurar domínio/redirects de Auth e definir disponibilidade, preços, contatos e mídias reais.
- Testar concorrência de agendamento, política de cancelamento, pedidos concorrentes e liberação de estoque.
- Configurar bucket/permissões em ambiente hospedado e verificar uploads.
- Implementar pagamentos por Edge Function e webhook somente após validação da documentação oficial vigente da InfinitePay. A documentação não estava acessível por DNS neste ambiente; nenhum endpoint ou fluxo de pagamento foi presumido, e `INFINITEPAY_API_KEY` ainda não foi configurada.
- Completar frete, cancelamento e reembolso, histórico de cliente, pré-visualização/publicação CMS e testes automatizados de integração/RLS.

## Produção

```powershell
npm run build
npm run preview
```
