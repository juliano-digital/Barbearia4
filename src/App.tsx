import { useEffect, useState } from 'react'
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Menu,
  Scissors,
  ShoppingBag,
  X,
} from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

const photo = (id: string, width = 900) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=86`

type Service = { id: string; name: string; description: string | null; duration_minutes: number; price_cents: number }
type Professional = { id: string; display_name: string; role_name: string | null; photo_url: string | null }
type Product = { id: string; name: string; description: string | null; price_cents: number; stock: number; category_id: string | null; image_url?: string }
type Category = { id: string; name: string; slug: string }
type CartLine = { product_id: string; quantity: number }
type PublishedContent = Record<string, unknown>

const localDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const dateParts = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`
}

const currency = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
const localTime = (iso: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(iso))
const contentText = (content: PublishedContent, section: string, key: string, fallback: string) => {
  const values = content[section]
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return fallback
  const value = (values as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [services, setServices] = useState<Service[]>([])
  const [barbers, setBarbers] = useState<Professional[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [selectedService, setSelectedService] = useState('')
  const [selectedProfessional, setSelectedProfessional] = useState('')
  const [selectedDate, setSelectedDate] = useState(localDate)
  const [availableSlots, setAvailableSlots] = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [storeLoading, setStoreLoading] = useState(false)
  const [storeError, setStoreError] = useState('')
  const [storeSearch, setStoreSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('')
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('barts-cart') ?? '[]')
      return Array.isArray(saved) ? saved.filter((line): line is CartLine =>
        typeof line?.product_id === 'string' && Number.isInteger(line?.quantity) && line.quantity > 0
      ) : []
    } catch {
      return []
    }
  })
  const [cartOpen, setCartOpen] = useState(false)
  const [customerSession, setCustomerSession] = useState<Session | null>(null)
  const [registerCustomer, setRegisterCustomer] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [orderId, setOrderId] = useState('')
  const [orderSubmitting, setOrderSubmitting] = useState(false)
  const [siteContent, setSiteContent] = useState<PublishedContent>({})
  const [siteContentError, setSiteContentError] = useState('')

  useEffect(() => {
    document.body.style.overflow = bookingOpen ? 'hidden' : ''
  }, [bookingOpen])

  useEffect(() => {
    if (!supabase) return
    let active = true
    setCatalogLoading(true)
    void Promise.all([
      supabase.from('services').select('id,name,description,duration_minutes,price_cents').eq('is_active', true).order('name'),
      supabase.from('professionals').select('id,display_name,role_name,photo_url').eq('is_active', true).order('display_name'),
    ]).then(([serviceResult, professionalResult]) => {
      if (!active) return
      if (serviceResult.error || professionalResult.error) {
        setCatalogError(serviceResult.error?.message ?? professionalResult.error?.message ?? 'Não foi possível carregar o catálogo.')
      } else {
        setServices(serviceResult.data ?? [])
        setBarbers(professionalResult.data ?? [])
      }
      setCatalogLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let active = true
    setStoreLoading(true)
    void Promise.all([
      client.from('products').select('id,name,description,price_cents,stock,category_id').eq('is_active', true).order('name'),
      client.from('product_categories').select('id,name,slug').order('name'),
    ]).then(async ([productResult, categoryResult]) => {
      if (!active) return
      if (productResult.error || categoryResult.error) {
        setStoreError(productResult.error?.message ?? categoryResult.error?.message ?? 'Não foi possível carregar a loja.')
        setStoreLoading(false)
        return
      }
      const productRows = (productResult.data ?? []) as Product[]
      const productIds = productRows.map(product => product.id)
      const imageResult = productIds.length
        ? await client.from('product_images').select('product_id,storage_path,position').in('product_id', productIds).order('position')
        : { data: [], error: null }
      if (!active) return
      if (imageResult.error) setStoreError(imageResult.error.message)
      const imageByProduct = new Map<string, string>()
      for (const image of imageResult.data ?? []) {
        if (!imageByProduct.has(image.product_id)) {
          imageByProduct.set(image.product_id, client.storage.from('barts-public').getPublicUrl(image.storage_path).data.publicUrl)
        }
      }
      setProducts(productRows.map(product => ({ ...product, image_url: imageByProduct.get(product.id) })))
      setCategories((categoryResult.data ?? []) as Category[])
      setStoreLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.from('site_content').select('content_key,content').eq('is_published', true)
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setSiteContentError(error.message)
          return
        }
        const published: PublishedContent = {}
        for (const row of data ?? []) published[row.content_key] = row.content
        setSiteContent(published)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setCustomerSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setCustomerSession(session))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    localStorage.setItem('barts-cart', JSON.stringify(cart))
  }, [cart])

  useEffect(() => {
    if (!supabase || !bookingOpen || !selectedService || !selectedProfessional || !selectedDate) {
      setAvailableSlots([])
      return
    }
    let active = true
    setSlotsLoading(true)
    setBookingError('')
    void supabase.rpc('get_booking_slots', {
      p_professional_id: selectedProfessional,
      p_service_id: selectedService,
      p_date: selectedDate,
    }).then(({ data, error }) => {
      if (!active) return
      if (error) {
        setAvailableSlots([])
        setBookingError(error.message)
      } else {
        setAvailableSlots((data ?? []).map((slot: { starts_at: string }) => slot.starts_at))
      }
      setSlotsLoading(false)
    })
    return () => { active = false }
  }, [bookingOpen, selectedService, selectedProfessional, selectedDate])

  const scrollTo = (id: string) => {
    setMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  const filteredProducts = products.filter(product =>
    (!activeCategory || product.category_id === activeCategory)
    && (!storeSearch || `${product.name} ${product.description ?? ''}`.toLocaleLowerCase().includes(storeSearch.toLocaleLowerCase()))
  )

  const addToCart = (product: Product) => {
    setCart(current => {
      const currentQuantity = current.find(line => line.product_id === product.id)?.quantity ?? 0
      if (currentQuantity >= product.stock) return current
      return currentQuantity
        ? current.map(line => line.product_id === product.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { product_id: product.id, quantity: 1 }]
    })
  }

  const changeCartQuantity = (productId: string, quantity: number) => {
    const product = products.find(item => item.id === productId)
    if (!product || quantity <= 0) {
      setCart(current => current.filter(line => line.product_id !== productId))
      return
    }
    setCart(current => current.map(line => line.product_id === productId
      ? { ...line, quantity: Math.min(quantity, product.stock) }
      : line))
  }

  const cartTotal = cart.reduce((total, line) => {
    const product = products.find(item => item.id === line.product_id)
    return total + (product?.price_cents ?? 0) * line.quantity
  }, 0)

  const submitCheckout = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || cart.length === 0) return
    setCheckoutError('')
    setOrderSubmitting(true)
    const form = new FormData(event.currentTarget)
    const name = String(form.get('customer_name'))
    const phone = String(form.get('customer_phone'))
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    let session = customerSession

    if (!session) {
      const result = registerCustomer
        ? await supabase.auth.signUp({ email, password, options: { data: { full_name: name, phone } } })
        : await supabase.auth.signInWithPassword({ email, password })
      if (result.error) {
        setCheckoutError(result.error.message)
        setOrderSubmitting(false)
        return
      }
      session = result.data.session
      if (!session) {
        setCheckoutError('Confirme seu e-mail para ativar a conta e concluir o pedido.')
        setOrderSubmitting(false)
        return
      }
    }

    const { data, error } = await supabase.rpc('create_customer_order', {
      p_items: cart,
      p_customer_name: name,
      p_customer_phone: phone,
    })
    if (error) setCheckoutError(error.message)
    else {
      setOrderId(String(data))
      setCart([])
    }
    setOrderSubmitting(false)
  }

  const submitBooking = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBookingError('')

    if (!supabase) {
      setBookingError('A reserva online ainda aguarda a configuração do Supabase.')
      return
    }

    const form = new FormData(event.currentTarget)
    const { error } = await supabase.rpc('create_public_booking', {
      p_customer_name: String(form.get('name')),
      p_customer_phone: String(form.get('phone')),
      p_service_id: String(form.get('service')),
      p_professional_id: String(form.get('barber')),
      p_starts_at: String(form.get('slot')),
    })

    if (error) {
      setBookingError(error.message)
      return
    }
    setSent(true)
  }

  return (
    <>
      <header className="topbar">
        <button className="brand" onClick={() => scrollTo('inicio')} aria-label="Ir para o início">
          <span className="brand-mark"><Scissors size={18} /></span>
          <span><strong>BARTS</strong><small>BARBER SHOP</small></span>
        </button>
        <nav className={menuOpen ? 'nav open' : 'nav'} aria-label="Navegação principal">
          <button onClick={() => scrollTo('inicio')}>Início</button>
          <button onClick={() => scrollTo('sobre')}>Sobre</button>
          <button onClick={() => scrollTo('servicos')}>Serviços</button>
          <button onClick={() => scrollTo('loja')}>Loja</button>
          <button onClick={() => scrollTo('profissionais')}>Profissionais</button>
          <button onClick={() => scrollTo('contato')}>Contato</button>
        </nav>
        <div className="header-actions">
          <button className="cart-button" onClick={() => setCartOpen(true)} aria-label={`Abrir carrinho, ${cart.reduce((sum, line) => sum + line.quantity, 0)} itens`}>
            <ShoppingBag size={17} /> {cart.reduce((sum, line) => sum + line.quantity, 0)}
          </button>
          <button className="header-cta" onClick={() => setBookingOpen(true)}>Agendar horário</button>
        </div>
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu">
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      <main>
        {siteContentError && <p className="form-error content-error" role="alert">{siteContentError}</p>}
        <section className="hero" id="inicio">
          <div className="hero-overlay" />
          <div className="hero-content">
            <p className="eyebrow"><span />{contentText(siteContent, 'home.hero', 'eyebrow', 'BARBEARIA PREMIUM')}</p>
            <h1>{contentText(siteContent, 'home.hero', 'title', 'Mais que um corte.')}<br /><em>{contentText(siteContent, 'home.hero', 'emphasis', 'Um ritual.')}</em></h1>
            <p className="hero-copy">{contentText(siteContent, 'home.hero', 'description', 'Técnicas clássicas, olhar contemporâneo e atendimento que faz você se sentir em casa.')}</p>
            <div className="hero-actions">
              <button className="btn primary" onClick={() => setBookingOpen(true)}>
                <CalendarDays size={17} /> Agendar agora
              </button>
              <button className="btn ghost" onClick={() => scrollTo('servicos')}>
                Conheça os serviços <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </section>

        <section className="intro-strip" id="sobre">
          <div>
            <p className="section-kicker">{contentText(siteContent, 'home.intro', 'kicker', 'Nossa essência')}</p>
            <h2>{contentText(siteContent, 'home.intro', 'title', 'Cuidados precisos,')}<br /><em>{contentText(siteContent, 'home.intro', 'emphasis', 'estilo único.')}</em></h2>
          </div>
          <p>{contentText(siteContent, 'home.intro', 'body', 'Na Barts, cada detalhe importa. Unimos técnica, experiência e um ambiente pensado para quem valoriza mais do que uma boa aparência.')}</p>
        </section>

        <section className="feature-grid">
          <article className="feature-card large">
            <img src={photo('photo-1503951914875-452162b0f3f1')} alt="Barbeiro realizando corte" />
            <div className="feature-label"><span>01</span><b>Cortes</b></div>
          </article>
          <article className="feature-card">
            <img src={photo('photo-1622287162716-f311baa1a2b8')} alt="Acabamento de barba" />
            <div className="feature-label"><span>02</span><b>Barbas</b></div>
          </article>
          <article className="feature-card">
            <img src={photo('photo-1622296089863-eb7fc530daa8')} alt="Ambiente da barbearia" />
            <div className="feature-label"><span>03</span><b>Experiência</b></div>
          </article>
        </section>

        <section className="booking-band">
          <div>
            <p className="section-kicker">Agendamento fácil</p>
            <h2>Seu horário, <em>sem esperar.</em></h2>
          </div>
          <button className="btn outline" onClick={() => setBookingOpen(true)}>
            Reservar agora <ChevronRight size={18} />
          </button>
        </section>

        <section className="services-section" id="servicos">
          <div className="section-heading">
            <div>
              <p className="section-kicker">O que fazemos</p>
              <h2>Serviços <em>sob medida</em></h2>
            </div>
            <button className="text-link" onClick={() => setBookingOpen(true)}>Ver todos <ArrowRight size={15} /></button>
          </div>
          <div className="service-grid">
            {catalogLoading ? <p className="catalog-state">Carregando serviços...</p> :
              catalogError ? <p className="catalog-state" role="alert">{catalogError}</p> :
              services.length === 0 ? <p className="catalog-state">Nenhum serviço disponível no momento.</p> :
              services.map((service, index) => (
              <button className="service-card" key={service.id} onClick={() => { setSelectedService(service.id); setBookingOpen(true) }}>
                <span className="service-number">0{index + 1}</span>
                <div className="service-icon"><Scissors size={22} /></div>
                <h3>{service.name}</h3>
                <p>{service.description ?? `${service.duration_minutes} minutos`}</p>
                <strong>{currency(service.price_cents)}</strong>
                <ChevronRight className="service-arrow" size={20} />
              </button>
            ))}
          </div>
        </section>

        <section className="store-section" id="loja">
          <div className="section-heading">
            <div><p className="section-kicker">Cuidados Barts</p><h2>Loja <em>da barbearia</em></h2></div>
            <button className="text-link" onClick={() => setCartOpen(true)}><ShoppingBag size={15} /> Carrinho ({cart.reduce((sum, line) => sum + line.quantity, 0)})</button>
          </div>
          <div className="store-controls">
            <input aria-label="Buscar produtos" placeholder="Buscar produtos..." value={storeSearch} onChange={event => setStoreSearch(event.target.value)} />
            <select aria-label="Filtrar por categoria" value={activeCategory} onChange={event => setActiveCategory(event.target.value)}>
              <option value="">Todas as categorias</option>
              {categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}
            </select>
          </div>
          {storeError && <p className="form-error" role="alert">{storeError}</p>}
          {storeLoading ? <p className="catalog-state">Carregando produtos...</p> :
            filteredProducts.length === 0 ? <p className="catalog-state">Nenhum produto encontrado. O catálogo pode ser cadastrado pelo painel administrativo.</p> :
            <div className="product-grid">
              {filteredProducts.map(product => (
                <article className="product-card" key={product.id}>
                  {product.image_url ? <img src={product.image_url} alt={product.name} /> : <div className="product-placeholder"><Scissors /></div>}
                  <div className="product-info">
                    <h3>{product.name}</h3>
                    <p>{product.description ?? 'Produto Barts'}</p>
                    <strong>{currency(product.price_cents)}</strong>
                    <button className="btn primary" disabled={product.stock <= (cart.find(line => line.product_id === product.id)?.quantity ?? 0)} onClick={() => addToCart(product)}>
                      {product.stock <= 0 ? 'Sem estoque' : 'Adicionar à sacola'}
                    </button>
                  </div>
                </article>
              ))}
            </div>}
        </section>

        <section className="team-section" id="profissionais">
          <div className="team-image">
            <img src={photo('photo-1621605815971-fbc98d665033', 1100)} alt="Interior da barbearia Barts" />
          </div>
          <div className="team-content">
            <p className="section-kicker">A equipe</p>
            <h2>Conheça quem cuida<br />do seu <em>visual.</em></h2>
            <div className="barber-list">
              {barbers.length === 0 ? <p className="catalog-state">{catalogError || 'A equipe será exibida após o cadastro dos profissionais.'}</p> : barbers.map((barber) => (
                <article className="barber-row" key={barber.id}>
                  {barber.photo_url ? <img src={barber.photo_url} alt={barber.display_name} /> : <span className="barber-avatar-fallback"><Scissors size={18} /></span>}
                  <div><h3>{barber.display_name}</h3><p>{barber.role_name ?? 'Profissional Barts'}</p></div>
                  <button aria-label={`Agendar com ${barber.display_name}`} onClick={() => { setSelectedProfessional(barber.id); setBookingOpen(true) }}>
                    <ChevronRight size={18} />
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="testimonial-section">
          <p className="section-kicker">Experiência Barts</p>
          <blockquote>Um tempo reservado para você, com atenção em cada detalhe.</blockquote>
        </section>

        <section className="contact-section" id="contato">
          <div className="contact-map">
            <img src={photo('photo-1503951914875-452162b0f3f1', 1100)} alt="Atendimento em barbearia" />
          </div>
          <div className="contact-card">
            <p className="section-kicker">{contentText(siteContent, 'contact', 'kicker', 'Visite a Barts')}</p>
            <h2>Seu próximo <em>ritual.</em></h2>
            <p className="contact-note">
              {contentText(siteContent, 'contact', 'address', 'Endereço ainda não cadastrado.')}
              <br />{contentText(siteContent, 'contact', 'phone', 'Telefone ainda não cadastrado.')}
              <br />{contentText(siteContent, 'contact', 'hours', 'Horários ainda não cadastrados.')}
            </p>
            <button className="btn primary" onClick={() => setBookingOpen(true)}>Agendar um horário</button>
          </div>
        </section>
      </main>

      <footer>
        <button className="brand footer-brand" onClick={() => scrollTo('inicio')}>
          <span className="brand-mark"><Scissors size={18} /></span>
          <span><strong>BARTS</strong><small>BARBER SHOP</small></span>
        </button>
        <p>Estilo clássico. Experiência moderna.</p>
        <a className="admin-footer-link" href="/admin">Acesso administrativo</a>
      </footer>

      {cartOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) { setCartOpen(false); setOrderId('') }
        }}>
          <section className="booking-modal cart-modal" role="dialog" aria-modal="true" aria-label="Carrinho e pedido">
            <button className="modal-close" onClick={() => { setCartOpen(false); setOrderId('') }} aria-label="Fechar"><X /></button>
            {orderId ? (
              <div className="success-state">
                <span><Check /></span>
                <p className="section-kicker">Pedido registrado</p>
                <h2>Pedido <em>{orderId.slice(0, 8)}</em></h2>
                <p>O pedido está pendente. Pagamento online ainda não está configurado; entre em contato com a barbearia para concluir a compra. O estoque foi reservado.</p>
              </div>
            ) : (
              <>
                <p className="section-kicker">Loja Barts</p>
                <h2>Sua <em>sacola</em></h2>
                {cart.length === 0 ? <p className="catalog-state">Sua sacola está vazia.</p> : (
                  <>
                    <div className="cart-lines">
                      {cart.map(line => {
                        const product = products.find(item => item.id === line.product_id)
                        if (!product) return null
                        return <div className="cart-line" key={line.product_id}>
                          <div><b>{product.name}</b><small>{currency(product.price_cents)} cada</small></div>
                          <div className="cart-quantity">
                            <button onClick={() => changeCartQuantity(product.id, line.quantity - 1)} aria-label={`Remover unidade de ${product.name}`}>−</button>
                            <span>{line.quantity}</span>
                            <button onClick={() => changeCartQuantity(product.id, line.quantity + 1)} disabled={line.quantity >= product.stock} aria-label={`Adicionar unidade de ${product.name}`}>+</button>
                          </div>
                          <strong>{currency(product.price_cents * line.quantity)}</strong>
                        </div>
                      })}
                    </div>
                    <p className="cart-total"><span>Subtotal estimado</span><strong>{currency(cartTotal)}</strong></p>
                    <p className="cart-disclaimer">O backend recalcula preços e estoque ao registrar o pedido. Frete e pagamento ainda não estão habilitados.</p>
                    {!supabase && <p className="form-error" role="status">Checkout aguardando configuração do Supabase.</p>}
                    <form className="checkout-form" onSubmit={submitCheckout}>
                      <label>Nome<input required name="customer_name" defaultValue={String(customerSession?.user.user_metadata?.full_name ?? '')} /></label>
                      <label>Telefone<input required name="customer_phone" defaultValue={String(customerSession?.user.user_metadata?.phone ?? '')} /></label>
                      {!customerSession && <>
                        <label>E-mail<input required type="email" name="email" /></label>
                        <label>Senha<input required type="password" minLength={8} name="password" /></label>
                        <label className="register-toggle"><input type="checkbox" checked={registerCustomer} onChange={event => setRegisterCustomer(event.target.checked)} /> Criar uma conta nova</label>
                      </>}
                      {checkoutError && <p className="form-error" role="alert">{checkoutError}</p>}
                      <button className="btn primary full" type="submit" disabled={orderSubmitting || !supabase}>{orderSubmitting ? 'Registrando pedido...' : 'Registrar pedido pendente'}</button>
                    </form>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {bookingOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setBookingOpen(false)
        }}>
          <section className="booking-modal" role="dialog" aria-modal="true" aria-label="Agendar horário">
            <button className="modal-close" onClick={() => setBookingOpen(false)} aria-label="Fechar"><X /></button>
            {sent ? (
              <div className="success-state">
                <span><Check /></span>
                <p className="section-kicker">Solicitação recebida</p>
                <h2>Sua solicitação foi <em>enviada.</em></h2>
                <p>O agendamento ficará pendente até a confirmação pela equipe.</p>
                <button className="btn primary" onClick={() => { setSent(false); setBookingOpen(false) }}>Concluir</button>
              </div>
            ) : (
              <>
                <p className="section-kicker">Agende sua visita</p>
                <h2>Reserve seu <em>horário</em></h2>
                {!supabase && <p className="form-error" role="status">A reserva online aguarda a configuração do Supabase.</p>}
                {supabase && catalogError && <p className="form-error" role="alert">{catalogError}</p>}
                <form onSubmit={submitBooking}>
                  <label>Seu nome<input required name="name" placeholder="Como devemos chamar você?" /></label>
                  <label>Telefone<input required name="phone" placeholder="(11) 99999-9999" /></label>
                  <label>Serviço<select required name="service" value={selectedService} onChange={event => { setSelectedService(event.target.value); setAvailableSlots([]) }}><option value="" disabled>Selecione um serviço</option>{services.map(service => <option value={service.id} key={service.id}>{service.name} — {currency(service.price_cents)}</option>)}</select></label>
                  <label>Profissional<select required name="barber" value={selectedProfessional} onChange={event => { setSelectedProfessional(event.target.value); setAvailableSlots([]) }}><option value="" disabled>Selecione um profissional</option>{barbers.map(barber => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></label>
                  <div className="form-row">
                    <label>Data<input required name="date" type="date" min={localDate()} value={selectedDate} onChange={event => { setSelectedDate(event.target.value); setAvailableSlots([]) }} /></label>
                    <label>Horário<select required name="slot" defaultValue=""><option value="" disabled>{slotsLoading ? 'Buscando...' : 'Selecione um horário'}</option>{availableSlots.map(slot => <option value={slot} key={slot}>{localTime(slot)}</option>)}</select></label>
                  </div>
                  {selectedService && selectedProfessional && !slotsLoading && availableSlots.length === 0 && !bookingError && <p className="form-error">Não há horários disponíveis para esta seleção e data.</p>}
                  {bookingError && <p className="form-error" role="alert">{bookingError}</p>}
                  <button className="btn primary full" type="submit">Confirmar agendamento</button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </>
  )
}

export default App
