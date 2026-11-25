import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { LogOut, RefreshCw, Search, Scissors, ShieldCheck } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type Field = {
  key: string
  label: string
  type?: 'text' | 'number' | 'boolean' | 'json' | 'date'
  required?: boolean
  options?: string[]
}

type Section = {
  id: string
  label: string
  table: string
  primaryKey: string | string[]
  sortBy: string
  readOnly?: boolean
  fields: Field[]
}

type Row = Record<string, unknown>

const sections: Section[] = [
  { id: 'bookings', label: 'Agendamentos', table: 'bookings', primaryKey: 'id', sortBy: 'starts_at', fields: [
    { key: 'customer_name', label: 'Cliente', required: true },
    { key: 'customer_phone', label: 'Telefone', required: true },
    { key: 'starts_at', label: 'Início (UTC ISO)' },
    { key: 'ends_at', label: 'Fim (UTC ISO)' },
    { key: 'status', label: 'Status', options: ['pending', 'confirmed', 'completed', 'cancelled'] },
  ] },
  { id: 'services', label: 'Serviços', table: 'services', primaryKey: 'id', sortBy: 'name', fields: [
    { key: 'name', label: 'Nome', required: true },
    { key: 'description', label: 'Descrição' },
    { key: 'duration_minutes', label: 'Duração (min)', type: 'number', required: true },
    { key: 'price_cents', label: 'Preço (centavos)', type: 'number', required: true },
    { key: 'is_active', label: 'Ativo', type: 'boolean' },
  ] },
  { id: 'professionals', label: 'Profissionais', table: 'professionals', primaryKey: 'id', sortBy: 'display_name', fields: [
    { key: 'display_name', label: 'Nome', required: true },
    { key: 'role_name', label: 'Especialidade' },
    { key: 'photo_url', label: 'URL da foto' },
    { key: 'is_active', label: 'Ativo', type: 'boolean' },
  ] },
  { id: 'availability', label: 'Disponibilidade', table: 'availability', primaryKey: 'id', sortBy: 'weekday', fields: [
    { key: 'professional_id', label: 'ID do profissional (UUID)', required: true },
    { key: 'weekday', label: 'Dia da semana (0=dom)', type: 'number', required: true },
    { key: 'start_time', label: 'Início (HH:MM)', required: true },
    { key: 'end_time', label: 'Fim (HH:MM)', required: true },
  ] },
  { id: 'service-links', label: 'Serviços por profissional', table: 'professional_services', primaryKey: ['professional_id', 'service_id'], sortBy: 'professional_id', fields: [
    { key: 'professional_id', label: 'ID do profissional (UUID)', required: true },
    { key: 'service_id', label: 'ID do serviço (UUID)', required: true },
  ] },
  { id: 'categories', label: 'Categorias', table: 'product_categories', primaryKey: 'id', sortBy: 'name', fields: [
    { key: 'name', label: 'Nome', required: true },
    { key: 'slug', label: 'Slug', required: true },
  ] },
  { id: 'products', label: 'Produtos e estoque', table: 'products', primaryKey: 'id', sortBy: 'name', fields: [
    { key: 'name', label: 'Nome', required: true },
    { key: 'description', label: 'Descrição' },
    { key: 'category_id', label: 'ID da categoria (UUID)' },
    { key: 'price_cents', label: 'Preço (centavos)', type: 'number', required: true },
    { key: 'stock', label: 'Estoque', type: 'number', required: true },
    { key: 'is_active', label: 'Ativo', type: 'boolean' },
  ] },
  { id: 'product-images', label: 'Imagens dos produtos', table: 'product_images', primaryKey: 'id', sortBy: 'position', fields: [
    { key: 'product_id', label: 'ID do produto (UUID)', required: true },
    { key: 'storage_path', label: 'Caminho no Storage', required: true },
    { key: 'alt_text', label: 'Texto alternativo' },
    { key: 'position', label: 'Posição', type: 'number' },
  ] },
  { id: 'media', label: 'Mídia do site', table: 'media_assets', primaryKey: 'id', sortBy: 'created_at', fields: [
    { key: 'bucket', label: 'Bucket', required: true },
    { key: 'storage_path', label: 'Caminho', required: true },
    { key: 'media_type', label: 'Tipo', options: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'], required: true },
    { key: 'alt_text', label: 'Texto alternativo' },
  ] },
  { id: 'content-history', label: 'Histórico do CMS', table: 'content_revisions', primaryKey: 'id', sortBy: 'changed_at', readOnly: true, fields: [
    { key: 'content_key', label: 'Chave' }, { key: 'content', label: 'Conteúdo JSON', type: 'json' }, { key: 'changed_at', label: 'Alterado em' },
  ] },
  { id: 'customers', label: 'Clientes', table: 'profiles', primaryKey: 'id', sortBy: 'created_at', readOnly: true, fields: [
    { key: 'full_name', label: 'Nome' }, { key: 'phone', label: 'Telefone' }, { key: 'role', label: 'Função' },
  ] },
  { id: 'orders', label: 'Pedidos', table: 'orders', primaryKey: 'id', sortBy: 'created_at', readOnly: true, fields: [
    { key: 'customer_name', label: 'Cliente' }, { key: 'total_cents', label: 'Total (centavos)' }, { key: 'status', label: 'Status' },
  ] },
  { id: 'payments', label: 'Pagamentos', table: 'payments', primaryKey: 'id', sortBy: 'created_at', readOnly: true, fields: [
    { key: 'order_id', label: 'ID do pedido' }, { key: 'provider', label: 'Provedor' }, { key: 'amount_cents', label: 'Valor (centavos)' }, { key: 'status', label: 'Status' },
  ] },
  { id: 'content', label: 'CMS', table: 'site_content', primaryKey: 'content_key', sortBy: 'content_key', fields: [
    { key: 'content_key', label: 'Chave', required: true }, { key: 'content', label: 'Conteúdo JSON', type: 'json', required: true }, { key: 'is_published', label: 'Publicado', type: 'boolean' },
  ] },
  { id: 'settings', label: 'Configurações públicas', table: 'site_settings', primaryKey: 'setting_key', sortBy: 'setting_key', fields: [
    { key: 'setting_key', label: 'Chave', required: true }, { key: 'setting_value', label: 'Valor JSON', type: 'json', required: true }, { key: 'is_public', label: 'Público', type: 'boolean' },
  ] },
  { id: 'delivery', label: 'Entrega', table: 'delivery_settings', primaryKey: 'id', sortBy: 'id', fields: [
    { key: 'enabled', label: 'Ativa', type: 'boolean' }, { key: 'flat_fee_cents', label: 'Taxa (centavos)', type: 'number' }, { key: 'free_over_cents', label: 'Frete grátis acima (centavos)', type: 'number' },
  ] },
]

const primaryKeys = (section: Section) =>
  Array.isArray(section.primaryKey) ? section.primaryKey : [section.primaryKey]

const rowKey = (row: Row, section: Section) =>
  primaryKeys(section).map(key => display(row[key])).join(':')

function display(value: unknown) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function AdminPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [roleLoading, setRoleLoading] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [accessError, setAccessError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [activeSection, setActiveSection] = useState<Section | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState('')
  const [loadingRows, setLoadingRows] = useState(false)
  const [dataError, setDataError] = useState('')
  const [editing, setEditing] = useState<Row | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({})
  const [saving, setSaving] = useState(false)
  const [summaryCounts, setSummaryCounts] = useState<Record<string, number | null>>({
    bookings: null, services: null, professionals: null, products: null, orders: null,
  })

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setLoginError(error.message)
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !session) {
      setIsAdmin(false)
      setRoleLoading(false)
      return
    }
    let active = true
    setRoleLoading(true)
    void supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        setIsAdmin(!error && data?.role === 'admin')
        setAccessError(error?.message ?? (data?.role === 'admin' ? '' : 'Esta conta não possui acesso administrativo.'))
        setRoleLoading(false)
      })
    return () => { active = false }
  }, [session])

  const loadRows = async () => {
    if (!supabase || !activeSection) return
    setLoadingRows(true)
    setDataError('')
    const { data, error, count } = await supabase.from(activeSection.table)
      .select('*', { count: 'exact' })
      .order(activeSection.sortBy, { ascending: activeSection.id === 'bookings' ? true : undefined })
      .range(page * 20, page * 20 + 19)
    if (error) {
      setDataError(error.message)
      setRows([])
      setTotal(0)
    } else {
      setRows((data ?? []) as Row[])
      setTotal(count ?? 0)
    }
    setLoadingRows(false)
  }

  useEffect(() => { void loadRows() }, [activeSection, page, isAdmin])

  useEffect(() => {
    if (!supabase || !isAdmin) return
    let active = true
    void Promise.all([
      supabase.from('bookings').select('id', { count: 'exact', head: true }),
      supabase.from('services').select('id', { count: 'exact', head: true }),
      supabase.from('professionals').select('id', { count: 'exact', head: true }),
      supabase.from('products').select('id', { count: 'exact', head: true }),
      supabase.from('orders').select('id', { count: 'exact', head: true }),
    ]).then(results => {
      if (!active) return
      const failedResult = results.find(result => result.error)
      setDataError(failedResult?.error?.message ?? '')
      setSummaryCounts({
        bookings: results[0].error ? null : results[0].count,
        services: results[1].error ? null : results[1].count,
        professionals: results[2].error ? null : results[2].count,
        products: results[3].error ? null : results[3].count,
        orders: results[4].error ? null : results[4].count,
      })
    })
    return () => { active = false }
  }, [isAdmin])

  const visibleRows = useMemo(() => {
    const search = filter.trim().toLocaleLowerCase()
    if (!search) return rows
    return rows.filter(row => activeSection?.fields.some(field => display(row[field.key]).toLocaleLowerCase().includes(search)))
  }, [filter, rows, activeSection])

  const beginCreate = () => {
    if (!activeSection) return
    setEditing({})
    setFormValues(Object.fromEntries(activeSection.fields.map(field => [
      field.key,
      field.type === 'boolean' ? false : field.type === 'json' ? '{}' : '',
    ])))
  }

  const beginEdit = (row: Row) => {
    if (!activeSection) return
    setEditing(row)
    setFormValues(Object.fromEntries(activeSection.fields.map(field => {
      const value = row[field.key]
      return [field.key, field.type === 'boolean' ? value === true : field.type === 'json'
        ? JSON.stringify(value ?? {}, null, 2)
        : display(value) === '—' ? '' : display(value)]
    })))
  }

  const saveRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !activeSection || !editing) return
    setSaving(true)
    setDataError('')
    try {
      const payload: Row = {}
      for (const field of activeSection.fields) {
        const value = formValues[field.key]
        if (field.type === 'boolean') payload[field.key] = value === true
        else if (field.type === 'json') payload[field.key] = JSON.parse(String(value || '{}')) as unknown
        else if (field.type === 'number') payload[field.key] = value === '' ? null : Number(value)
        else payload[field.key] = value === '' ? null : String(value)
      }

      const keys = primaryKeys(activeSection)
      const isExisting = keys.every(key => editing[key] !== undefined)
      let result
      if (isExisting) {
        let query = supabase.from(activeSection.table).update(payload)
        for (const key of keys) query = query.eq(key, editing[key])
        result = await query
      } else {
        result = await supabase.from(activeSection.table).insert(payload)
      }
      if (result.error) throw result.error
      setEditing(null)
      await loadRows()
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'Não foi possível salvar o registro.')
    } finally {
      setSaving(false)
    }
  }

  const deleteRecord = async (row: Row) => {
    if (!supabase || !activeSection || activeSection.readOnly) return
    if (!window.confirm('Confirma a exclusão deste registro?')) return
    let query = supabase.from(activeSection.table).delete()
    for (const key of primaryKeys(activeSection)) query = query.eq(key, row[key])
    const { error } = await query
    if (error) setDataError(error.message)
    else await loadRows()
  }

  const uploadMedia = async (file: File) => {
    if (!supabase || !isAdmin || activeSection?.id !== 'media') return
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
    if (!allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
      setDataError('Envie uma imagem JPEG, PNG, WebP ou AVIF de até 5 MB.')
      return
    }
    const extension = file.type.split('/')[1]
    const storagePath = `cms/${crypto.randomUUID()}.${extension}`
    setDataError('')
    const { error: uploadError } = await supabase.storage.from('barts-public')
      .upload(storagePath, file, { contentType: file.type, upsert: false })
    if (uploadError) {
      setDataError(uploadError.message)
      return
    }
    const { error: recordError } = await supabase.from('media_assets').insert({
      bucket: 'barts-public',
      storage_path: storagePath,
      media_type: file.type,
      alt_text: '',
    })
    if (recordError) {
      const { error: removeError } = await supabase.storage.from('barts-public').remove([storagePath])
      setDataError(removeError
        ? `${recordError.message} A limpeza do arquivo enviado também falhou: ${removeError.message}`
        : recordError.message)
      return
    }
    await loadRows()
  }

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    setLoginError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setLoginError(error.message)
  }

  if (!supabase) {
    return <main className="admin-auth"><div className="admin-auth-card"><ShieldCheck /><h1>Painel Barts</h1><p>Configure as variáveis públicas do Supabase em <code>.env</code> para acessar a administração.</p></div></main>
  }
  if (authLoading || (session && roleLoading)) {
    return <main className="admin-auth"><p className="admin-loading">Verificando sessão e permissões...</p></main>
  }
  if (!session || !isAdmin) {
    return (
      <main className="admin-auth">
        <form className="admin-auth-card" onSubmit={signIn}>
          <div className="admin-logo"><Scissors /><span>BARTS <small>ADMINISTRAÇÃO</small></span></div>
          <h1>Acesso administrativo</h1>
          <p>Entre com uma conta autorizada pela função administrativa no banco.</p>
          <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
          {(loginError || accessError) && <p className="admin-error" role="alert">{loginError || accessError}</p>}
          <button className="admin-primary" type="submit">Entrar</button>
          <a className="admin-back" href="/">Voltar ao site</a>
        </form>
      </main>
    )
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-logo" href="/"><Scissors /><span>BARTS <small>ADMIN</small></span></a>
        <p className="admin-nav-label">GERENCIAMENTO</p>
        <button className={activeSection ? '' : 'selected'} onClick={() => { setActiveSection(null); setPage(0) }}>Visão geral</button>
        {sections.map(section => (
          <button key={section.id} className={activeSection?.id === section.id ? 'selected' : ''} onClick={() => { setActiveSection(section); setPage(0); setFilter('') }}>
            {section.label}{section.readOnly ? <small>consulta</small> : null}
          </button>
        ))}
        <button className="admin-signout" onClick={() => { if (supabase) void supabase.auth.signOut() }}><LogOut size={16} /> Sair</button>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar"><div><p className="admin-nav-label">BARTS BARBER SHOP</p><h1>{activeSection?.label ?? 'Visão geral'}</h1></div><button className="admin-refresh" onClick={() => activeSection ? void loadRows() : window.location.reload()}><RefreshCw size={16} /> Atualizar</button></header>
        {dataError && <p className="admin-error admin-banner" role="alert">{dataError}</p>}
        {!activeSection ? (
          <div className="admin-welcome">
            <section className="admin-welcome-card"><h2>Painel conectado</h2><p>Os dados abaixo vêm do Supabase e dependem das migrations e das permissões RLS aplicadas.</p></section>
            <div className="admin-metrics">
              {sections.filter(section => ['bookings', 'services', 'professionals', 'products', 'orders'].includes(section.id)).map(section => (
                <button key={section.id} onClick={() => setActiveSection(section)}><span>{section.label}</span><b>{summaryCounts[section.id] ?? '—'}</b></button>
              ))}
            </div>
            <section className="admin-welcome-card"><h3>Primeiro administrador</h3><p>O acesso é concedido somente pelo operador do Supabase após criar uma conta; nenhuma promoção de função é oferecida nesta interface.</p></section>
          </div>
        ) : (
          <section className="admin-data-card">
            <div className="admin-toolbar">
              <label className="admin-search"><Search size={16} /><input placeholder="Pesquisar nesta página..." value={filter} onChange={event => setFilter(event.target.value)} /></label>
              {!activeSection.readOnly && <div className="admin-toolbar-actions">
                {activeSection.id === 'media' && <label className="admin-upload">Enviar imagem<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={event => {
                  const file = event.currentTarget.files?.[0]
                  if (file) void uploadMedia(file)
                  event.currentTarget.value = ''
                }} /></label>}
                <button className="admin-primary" onClick={beginCreate}>Novo registro</button>
              </div>}
            </div>
            <div className="admin-table-wrap">
              {loadingRows ? <p className="admin-loading">Carregando dados...</p> : visibleRows.length === 0 ? <p className="admin-empty">Nenhum registro encontrado nesta página.</p> : (
                <table className="admin-table"><thead><tr>{activeSection.fields.map(field => <th key={field.key}>{field.label}</th>)}<th>Ações</th></tr></thead>
                  <tbody>{visibleRows.map((row, index) => <tr key={rowKey(row, activeSection) || String(index)}>
                    {activeSection.fields.map(field => <td key={field.key} title={display(row[field.key])}>{display(row[field.key])}</td>)}
                    <td className="admin-actions">{!activeSection.readOnly && <><button onClick={() => beginEdit(row)}>Editar</button><button className="danger" onClick={() => void deleteRecord(row)}>Excluir</button></>}</td>
                  </tr>)}</tbody>
                </table>
              )}
            </div>
            <div className="admin-pagination"><span>{total} registro(s) — página {page + 1}</span><div><button disabled={page === 0} onClick={() => setPage(current => current - 1)}>Anterior</button><button disabled={(page + 1) * 20 >= total} onClick={() => setPage(current => current + 1)}>Próxima</button></div></div>
          </section>
        )}
      </main>

      {editing && activeSection && (
        <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null) }}>
          <form className="admin-edit-modal" onSubmit={saveRecord}>
            <button type="button" className="admin-modal-close" onClick={() => setEditing(null)}>Fechar</button>
            <h2>{primaryKeys(activeSection).every(key => editing[key] !== undefined) ? 'Editar registro' : 'Novo registro'}</h2>
            <div className="admin-fields">{activeSection.fields.map(field => (
              <label key={field.key}>{field.label}
                {field.type === 'boolean' ? <input type="checkbox" checked={formValues[field.key] === true} onChange={event => setFormValues(values => ({ ...values, [field.key]: event.target.checked }))} /> :
                  field.options ? <select required={field.required} value={String(formValues[field.key] ?? '')} onChange={event => setFormValues(values => ({ ...values, [field.key]: event.target.value }))}><option value="">Selecione</option>{field.options.map(option => <option key={option}>{option}</option>)}</select> :
                  field.type === 'json' ? <textarea required={field.required} rows={5} value={String(formValues[field.key] ?? '')} onChange={event => setFormValues(values => ({ ...values, [field.key]: event.target.value }))} /> :
                  <input type={field.type === 'number' ? 'number' : 'text'} required={field.required} value={String(formValues[field.key] ?? '')} onChange={event => setFormValues(values => ({ ...values, [field.key]: event.target.value }))} />}
              </label>
            ))}</div>
            <button className="admin-primary" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
          </form>
        </div>
      )}
    </div>
  )
}

export default AdminPage
