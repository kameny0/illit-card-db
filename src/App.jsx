import { useEffect, useMemo, useState } from 'react'
import {
  Search, ImagePlus, Plus, LogIn, LogOut, X, Check, Ban,
  Camera, RefreshCw, ExternalLink, ShieldCheck, UserRound,
  Disc3, Users, SlidersHorizontal, AlertCircle
} from 'lucide-react'
import { supabase, supabaseReady } from './lib/supabase'
import { prepareAndUploadImage } from './lib/imageUpload'
import { createImageHash, hashSimilarity } from './lib/imageHash'

const money = value => new Intl.NumberFormat('ja-JP', {
  style: 'currency', currency: 'JPY', maximumFractionDigits: 0
}).format(value)

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [cards, setCards] = useState([])
  const [groups, setGroups] = useState([])
  const [members, setMembers] = useState([])
  const [albums, setAlbums] = useState([])
  const [prices, setPrices] = useState([])
  const [settings, setSettings] = useState({ require_user_approval: true, require_card_approval: true, require_price_approval: true })
  const [pendingUsers, setPendingUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('browse')
  const [selectedCard, setSelectedCard] = useState(null)
  const [search, setSearch] = useState('')
  const [memberFilter, setMemberFilter] = useState('')
  const [albumFilter, setAlbumFilter] = useState('')
  const [imageMatches, setImageMatches] = useState(null)
  const [imageSearching, setImageSearching] = useState(false)
  const [notice, setNotice] = useState('')
  const [authMode, setAuthMode] = useState('login')

  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    if (!supabaseReady) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabaseReady) return
    if (!session?.user) {
      setProfile(null)
      loadPublicData()
      return
    }
    loadProfile(session.user.id)
    loadPublicData()
  }, [session])

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) setNotice(error.message)
    setProfile(data)
  }

  async function loadPublicData() {
    setLoading(true)
    const [g, m, a, c, p, st] = await Promise.all([
      supabase.from('groups').select('*').order('name'),
      supabase.from('members').select('*').order('name'),
      supabase.from('albums').select('*').order('name'),
      supabase.from('cards')
        .select('*, members(name), albums(name), groups(name)')
        .eq('status', 'approved').order('created_at', { ascending: false }).limit(500),
      supabase.from('price_entries')
        .select('*').eq('status', 'approved').order('created_at', { ascending: false }).limit(2000),
      supabase.from('site_settings').select('*').eq('id', true).maybeSingle(),
    ])
    if (g.error || m.error || a.error || c.error || p.error) {
      setNotice([g.error, m.error, a.error, c.error, p.error].filter(Boolean).map(e => e.message).join(' / '))
    }
    setGroups(g.data || [])
    setMembers(m.data || [])
    setAlbums(a.data || [])
    setCards(c.data || [])
    setPrices(p.data || [])
    if (st.data) setSettings(st.data)
    setLoading(false)
  }

  const visibleCards = useMemo(() => {
    let result = cards
    if (memberFilter) result = result.filter(card => String(card.member_id) === memberFilter)
    if (albumFilter) result = result.filter(card => String(card.album_id) === albumFilter)
    if (search.trim()) {
      const term = search.toLowerCase()
      result = result.filter(card =>
        [card.card_name, card.benefit, card.members?.name, card.albums?.name, card.groups?.name]
          .filter(Boolean).some(value => value.toLowerCase().includes(term))
      )
    }
    if (imageMatches) {
      const scores = new Map(imageMatches.map(item => [item.id, item.score]))
      result = [...result].sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0))
    }
    return result
  }, [cards, memberFilter, albumFilter, search, imageMatches])

  async function signInOrSignUp(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = form.get('email')
    const password = form.get('password')
    const username = form.get('username') || email.split('@')[0]
    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { data: { username } } })
      : await supabase.auth.signInWithPassword({ email, password })
    if (result.error) setNotice(result.error.message)
    else setNotice(authMode === 'signup'
      ? '登録メールを確認してください。確認後にログインできます。'
      : 'ログインしました。')
  }

  async function signOut() {
    await supabase.auth.signOut()
    setNotice('ログアウトしました')
  }

  async function searchByImage(file) {
    if (!file) return
    setImageSearching(true)
    setImageMatches(null)
    setNotice('')
    try {
      const hash = await createImageHash(file)
      const ranked = cards
        .filter(card => card.image_hash)
        .map(card => ({ id: card.id, score: hashSimilarity(hash, card.image_hash) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)
      setImageMatches(ranked)
      setNotice(ranked.length
        ? '画像の見た目が近いカードを上位に表示しています。'
        : '比較できるカードがありません。カード登録時に画像ハッシュが保存されている必要があります。')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setImageSearching(false)
    }
  }

  function clearImageSearch() {
    setImageMatches(null)
  }

  async function loadCardPrices(cardId) {
    const { data } = await supabase
      .from('price_entries').select('*')
      .eq('card_id', cardId).eq('status', 'approved')
      .order('created_at', { ascending: false })
    return data || []
  }

  async function openCard(card) {
    const cardPrices = await loadCardPrices(card.id)
    setSelectedCard({ ...card, prices: cardPrices })
  }

  async function reviewItem(table, id, status) {
    const { error } = await supabase.from(table).update({ status }).eq('id', id)
    if (error) setNotice(error.message)
    else {
      setNotice(status === 'approved' ? '承認しました' : '却下しました')
      loadPublicData()
      if (tab === 'admin') loadPending()
    }
  }

  const [pendingCards, setPendingCards] = useState([])
  const [pendingPrices, setPendingPrices] = useState([])
  async function loadPending() {
    const [c, p, u] = await Promise.all([
      supabase.from('cards')
        .select('*, members(name), albums(name), groups(name)')
        .eq('status', 'pending').order('created_at'),
      supabase.from('price_entries')
        .select('*, cards(card_name, benefit, members(name))')
        .eq('status', 'pending').order('created_at'),
      supabase.from('profiles').select('*').eq('account_status', 'pending').order('created_at'),
    ])
    if (c.error || p.error) setNotice(c.error?.message || p.error?.message)
    setPendingCards(c.data || [])
    setPendingPrices(p.data || [])
    setPendingUsers(u.data || [])
  }

  async function updateSetting(key, value) {
    const next = { ...settings, [key]: value }
    setSettings(next)
    const { error } = await supabase.from('site_settings').update({ [key]: value, updated_at: new Date().toISOString() }).eq('id', true)
    if (error) { setNotice(error.message); setSettings(settings) } else setNotice('承認設定を更新しました')
  }

  async function reviewUser(id, status) {
    const { error } = await supabase.from('profiles').update({ account_status: status }).eq('id', id)
    if (error) setNotice(error.message); else { setNotice(status === 'approved' ? 'ユーザーを承認しました' : 'ユーザーを却下しました'); loadPending() }
  }

  useEffect(() => {
    if (isAdmin && tab === 'admin') loadPending()
  }, [isAdmin, tab])

  if (!supabaseReady) {
    return <main className="setup-screen">
      <div className="setup-card">
        <h1>Photocard Archive</h1>
        <p>Supabaseの接続情報がまだ設定されていません。</p>
        <p><code>.env.local</code> を作成し、<code>.env.example</code> を参考にURLとPublishable keyを入力してください。</p>
      </div>
    </main>
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => { setTab('browse'); setSelectedCard(null) }}>
          <span className="brand-mark">P</span>
          <span>Photocard Archive<small>COMMUNITY DATABASE</small></span>
        </a>
        <div className="top-actions">
          {session ? <>
            <span className="user-label"><UserRound size={15}/>{profile?.username || session.user.email}</span>
            <button className="icon-button" onClick={signOut} title="ログアウト"><LogOut size={17}/></button>
          </> : <button className="button small" onClick={() => setTab('auth')}><LogIn size={16}/>ログイン</button>}
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div>
            <p className="eyebrow">K-POP PHOTOCARD DATABASE</p>
            <h1>推しのトレカ相場を、<br/><em>みんなで記録。</em></h1>
            <p className="hero-copy">カードを探す、価格を記録する、みんなで情報を更新する。</p>
          </div>
          <div className="hero-stamp"><Disc3 size={42}/><span>COMMUNITY<br/>ARCHIVE</span></div>
        </section>

        <nav className="tabs">
          <button className={tab === 'browse' ? 'active' : ''} onClick={() => { setTab('browse'); setSelectedCard(null) }}><Search size={16}/>カードを探す</button>
          <button className={tab === 'submit' ? 'active' : ''} onClick={() => setTab('submit')}><Plus size={16}/>登録する</button>
          {isAdmin && <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}><ShieldCheck size={16}/>承認管理</button>}
          {!session && <button className={tab === 'auth' ? 'active' : ''} onClick={() => setTab('auth')}><LogIn size={16}/>ログイン</button>}
        </nav>

        {notice && <div className="notice"><AlertCircle size={16}/><span>{notice}</span><button onClick={() => setNotice('')}><X size={15}/></button></div>}

        {tab === 'auth' && <AuthPanel mode={authMode} setMode={setAuthMode} onSubmit={signInOrSignUp}/>}

        {tab === 'browse' && !selectedCard && <section>
          <div className="section-heading">
            <div><p className="eyebrow">EXPLORE CARDS</p><h2>トレカを探す</h2></div>
            <span className="count">{visibleCards.length} CARDS</span>
          </div>
          <div className="search-panel">
            <label className="search-box"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="カード名・特典名・メンバー名で検索"/></label>
            <div className="filter-row">
              <label><Users size={15}/><select value={memberFilter} onChange={e => setMemberFilter(e.target.value)}><option value="">すべてのメンバー</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
              <label><Disc3 size={15}/><select value={albumFilter} onChange={e => setAlbumFilter(e.target.value)}><option value="">すべてのアルバム</option>{albums.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            </div>
            <div className="image-search-row">
              <label className="button outline file-button"><Camera size={16}/>{imageSearching ? '検索中...' : '画像をアップロードして類似検索'}<input type="file" accept="image/*" disabled={imageSearching} onChange={e => searchByImage(e.target.files?.[0])}/></label>
              {imageMatches && <button className="text-button" onClick={clearImageSearch}><X size={14}/>画像検索を解除</button>}
            </div>
            {imageMatches && <p className="hint">画像の類似度順です。背景・角度・トリミングによって順位が変わることがあります。</p>}
          </div>
          {loading ? <div className="empty"><RefreshCw className="spin"/>読み込み中...</div> :
            visibleCards.length ? <div className="card-grid">{visibleCards.map(card => <CardTile key={card.id} card={card} prices={prices.filter(p => p.card_id === card.id)} imageScore={imageMatches?.find(x => x.id === card.id)?.score} onClick={() => openCard(card)}/>)}</div> :
            <div className="empty"><ImagePlus size={32}/><strong>カードがまだありません</strong><span>最初のトレカを登録してみましょう。</span></div>}
        </section>}

        {tab === 'browse' && selectedCard && <CardDetail card={selectedCard} onBack={() => setSelectedCard(null)} session={session} settings={settings} onPriceAdded={async () => openCard(selectedCard)}/>}

        {tab === 'submit' && <SubmitPanel session={session} profile={profile} settings={settings} groups={groups} members={members} albums={albums} onDone={() => { setTab('browse'); setNotice('登録を受け付けました。公開状態は現在の承認設定に従います。') }} onNeedLogin={() => setTab('auth')}/>}

        {tab === 'admin' && isAdmin && <section>
          <div className="section-heading"><div><p className="eyebrow">MODERATION</p><h2>承認管理</h2></div><button className="button outline small" onClick={loadPending}><RefreshCw size={15}/>更新</button></div>
          <div className="form-card"><p className="eyebrow">SITE SETTINGS</p><h3>承認設定</h3><p className="hint">OFFにすると新規登録分は即時公開されます。すでに公開済みのデータには影響しません。</p>{[[ 'require_user_approval','新規ユーザーの承認','新規アカウントを管理者が承認するまで登録機能を利用不可にする' ],['require_card_approval','トレカ情報の承認','新しいカード情報を承認後に公開する'],['require_price_approval','価格情報の承認','売却価格・出品価格を承認後に公開する']].map(([key,label,desc]) => <label className="setting-row" key={key}><span><strong>{label}</strong><small>{desc}</small></span><input type="checkbox" checked={!!settings[key]} onChange={e => updateSetting(key,e.target.checked)}/></label>)}</div>
          <h3 className="subheading">ユーザー申請 <span>{pendingUsers.length}</span></h3>{pendingUsers.map(user => <div className="review-card" key={user.id}><strong>{user.username}</strong><div className="review-actions"><button className="approve" onClick={() => reviewUser(user.id,'approved')}>承認</button><button className="reject" onClick={() => reviewUser(user.id,'rejected')}>却下</button></div></div>)}{!pendingUsers.length && <p className="muted">承認待ちユーザーはいません。</p>}
          <h3 className="subheading">トレカ申請 <span>{pendingCards.length}</span></h3>
          {pendingCards.map(card => <ReviewCard key={card.id} item={card} type="card" onReview={reviewItem}/>)}
          {!pendingCards.length && <p className="muted">承認待ちのトレカはありません。</p>}
          <h3 className="subheading">価格申請 <span>{pendingPrices.length}</span></h3>
          {pendingPrices.map(price => <ReviewCard key={price.id} item={price} type="price" onReview={reviewItem}/>)}
          {!pendingPrices.length && <p className="muted">承認待ちの価格情報はありません。</p>}
        </section>}

        <footer><span>PHOTOCARD ARCHIVE</span><span>Community-powered price reference</span></footer>
      </main>
    </div>
  )
}

function AuthPanel({ mode, setMode, onSubmit }) {
  return <section className="form-card narrow">
    <p className="eyebrow">ACCOUNT</p><h2>{mode === 'signup' ? 'アカウント作成' : 'ログイン'}</h2>
    <form onSubmit={onSubmit} className="form-stack">
      {mode === 'signup' && <Field label="表示名"><input name="username" placeholder="Discordで使っている名前など" required/></Field>}
      <Field label="メールアドレス"><input name="email" type="email" required placeholder="name@example.com"/></Field>
      <Field label="パスワード"><input name="password" type="password" minLength="6" required placeholder="6文字以上"/></Field>
      <button className="button primary full" type="submit">{mode === 'signup' ? 'アカウントを作成' : 'ログイン'}</button>
    </form>
    <button className="text-button switch-auth" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>
      {mode === 'signup' ? 'すでにアカウントを持っている' : '初めて利用する方はこちら'}
    </button>
    <p className="hint">この初期版はメールアドレスで登録します。Discordサーバー所属の自動確認はまだ行いません。</p>
  </section>
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function SubmitPanel({ session, profile, settings, groups, members, albums, onDone, onNeedLogin }) {
  const [kind, setKind] = useState('card')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cardId, setCardId] = useState('')
  const [form, setForm] = useState({ group_id: '', member_id: '', album_id: '', card_name: '', benefit: '', price: '', price_type: 'sold', source: 'メルカリ', source_url: '', transaction_date: '' })

  function update(key, value) { setForm(prev => ({ ...prev, [key]: value })) }
  function chooseFile(nextFile) {
    setFile(nextFile)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(nextFile ? URL.createObjectURL(nextFile) : '')
  }

  async function submit(event) {
    event.preventDefault()
    if (!session) { onNeedLogin(); return }
    setBusy(true); setError('')
    try {
      if (kind === 'card') {
        if (!file) throw new Error('カード画像を選択してください')
        const uploaded = await prepareAndUploadImage(file, session.user.id)
        const { error: insertError } = await supabase.from('cards').insert({
          group_id: Number(form.group_id),
          member_id: Number(form.member_id),
          album_id: form.album_id ? Number(form.album_id) : null,
          card_name: form.card_name.trim(),
          benefit: form.benefit.trim() || null,
          image_path: uploaded.imagePath,
          image_hash: uploaded.imageHash,
          submitted_by: session.user.id,
          status: settings.require_card_approval ? 'pending' : 'approved'
        })
        if (insertError) throw insertError
      } else {
        if (!cardId) throw new Error('対象のカードを選択してください')
        const { error: insertError } = await supabase.from('price_entries').insert({
          card_id: Number(cardId),
          user_id: session.user.id,
          price: Number(form.price),
          price_type: form.price_type,
          source: form.source.trim(),
          source_url: form.source_url.trim() || null,
          transaction_date: form.transaction_date || null,
          status: settings.require_price_approval ? 'pending' : 'approved'
        })
        if (insertError) throw insertError
      }
      onDone()
    } catch (e) {
      setError(e.message || '登録に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  if (!session) return <div className="form-card"><h2>登録にはログインが必要です</h2><p className="muted">ログイン後、トレカや価格情報を申請できます。</p><button className="button primary" onClick={onNeedLogin}>ログインへ</button></div>

  if (session && profile?.account_status !== 'approved') return <div className="form-card"><h2>アカウント承認待ち</h2><p>管理者がアカウントを承認すると登録できるようになります。</p></div>

  return <section className="form-card">
    <p className="eyebrow">CONTRIBUTE</p><h2>情報を登録する</h2>
    <div className="segmented">
      <button className={kind === 'card' ? 'selected' : ''} onClick={() => setKind('card')} type="button">新しいトレカ</button>
      <button className={kind === 'price' ? 'selected' : ''} onClick={() => setKind('price')} type="button">価格情報</button>
    </div>
    {error && <div className="error">{error}</div>}
    <form className="form-stack" onSubmit={submit}>
      {kind === 'card' ? <>
        <Field label="カード画像（必須）">
          <input type="file" accept="image/*" onChange={e => chooseFile(e.target.files?.[0] || null)} required/>
        </Field>
        {preview && <img className="upload-preview" src={preview} alt="アップロード画像プレビュー"/>}
        <p className="hint">画像はブラウザ内でWebPに圧縮してから保存します。目安は最大幅1,400px・約250KBです。</p>
        <Field label="グループ"><select value={form.group_id} onChange={e => update('group_id', e.target.value)} required><option value="">選択してください</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="メンバー"><select value={form.member_id} onChange={e => update('member_id', e.target.value)} required><option value="">選択してください</option>{members.filter(m => !form.group_id || String(m.group_id) === form.group_id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <Field label="アルバム"><select value={form.album_id} onChange={e => update('album_id', e.target.value)}><option value="">未指定・その他</option>{albums.filter(a => !form.group_id || String(a.group_id) === form.group_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="カード名"><input value={form.card_name} onChange={e => update('card_name', e.target.value)} required placeholder="例：特典トレカ / ラキドロ など"/></Field>
        <Field label="特典・バージョンなど"><input value={form.benefit} onChange={e => update('benefit', e.target.value)} placeholder="例：Weverse特典、店舗名、イベント名"/></Field>
      </> : <>
        <Field label="対象カード"><select value={cardId} onChange={e => setCardId(e.target.value)} required><option value="">カードを選択</option>{/* approved cards are not loaded here yet; see note in README */}</select></Field>
        <p className="hint">価格登録フォームのカード候補は、公開カード一覧を取得する追加処理が必要です。READMEの「次の実装項目」を参照してください。</p>
        <Field label="価格（円）"><input type="number" min="1" step="1" value={form.price} onChange={e => update('price', e.target.value)} required placeholder="1500"/></Field>
        <Field label="価格区分"><select value={form.price_type} onChange={e => update('price_type', e.target.value)}><option value="sold">実際に売れた価格</option><option value="listing">出品中の価格</option></select></Field>
        <Field label="出典サイト"><input value={form.source} onChange={e => update('source', e.target.value)} required placeholder="メルカリ / Yahoo!フリマ / X など"/></Field>
        <Field label="商品URL"><input type="url" value={form.source_url} onChange={e => update('source_url', e.target.value)} placeholder="https://..."/></Field>
        <Field label="売却日・確認日"><input type="date" value={form.transaction_date} onChange={e => update('transaction_date', e.target.value)}/></Field>
      </>}
      <button className="button primary full" disabled={busy} type="submit">{busy ? '送信中...' : '承認待ちとして申請する'}</button>
    </form>
  </section>
}

function CardTile({ card, prices, imageScore, onClick }) {
  const sold = prices.filter(p => p.price_type === 'sold').map(p => p.price)
  const listings = prices.filter(p => p.price_type === 'listing').map(p => p.price)
  const median = values => {
    if (!values.length) return null
    const sorted = [...values].sort((a,b) => a-b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid-1] + sorted[mid]) / 2)
  }
  return <button className="card-tile" onClick={onClick}>
    <div className="card-image-wrap">
      <img src={cardImageUrl(card.image_path)} alt={card.card_name} loading="lazy"/>
      {imageScore != null && <span className="similarity">{Math.round(imageScore * 100)}% match</span>}
    </div>
    <div className="tile-info">
      <span className="tile-member">{card.members?.name || '未分類'}</span>
      <strong>{card.card_name}</strong>
      {card.benefit && <span className="tile-benefit">{card.benefit}</span>}
      <div className="tile-prices">
        <span>売却 {median(sold) == null ? '—' : money(median(sold))}</span>
        <span>出品 {median(listings) == null ? '—' : money(median(listings))}</span>
      </div>
    </div>
  </button>
}

function cardImageUrl(path) {
  if (!path) return ''
  const { data } = supabase.storage.from('card-images').getPublicUrl(path)
  return data.publicUrl
}

function CardDetail({ card, onBack, session, settings, onPriceAdded }) {
  const [showPriceForm, setShowPriceForm] = useState(false)
  const [form, setForm] = useState({ price: '', price_type: 'sold', source: 'メルカリ', source_url: '', transaction_date: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const sold = card.prices.filter(p => p.price_type === 'sold')
  const listings = card.prices.filter(p => p.price_type === 'listing')
  const avg = values => values.length ? Math.round(values.reduce((a,p) => a + p.price, 0) / values.length) : null

  async function addPrice(event) {
    event.preventDefault()
    if (!session) { setError('価格登録にはログインが必要です'); return }
    setBusy(true); setError('')
    const { error: insertError } = await supabase.from('price_entries').insert({
      card_id: card.id,
      user_id: session.user.id,
      price: Number(form.price),
      price_type: form.price_type,
      source: form.source,
      source_url: form.source_url || null,
      transaction_date: form.transaction_date || null,
      status: settings.require_price_approval ? 'pending' : 'approved'
    })
    setBusy(false)
    if (insertError) setError(insertError.message)
    else { setShowPriceForm(false); setError(settings.require_price_approval ? '価格情報を承認待ちとして申請しました' : '価格情報を登録しました') }
  }

  return <section>
    <button className="back-button" onClick={onBack}>← カード一覧に戻る</button>
    <div className="detail-layout">
      <img className="detail-image" src={cardImageUrl(card.image_path)} alt={card.card_name}/>
      <div className="detail-copy">
        <p className="eyebrow">{card.groups?.name} / {card.albums?.name || 'アルバム未指定'}</p>
        <h2>{card.members?.name} – {card.card_name}</h2>
        {card.benefit && <p className="muted">{card.benefit}</p>}
        <div className="price-summary">
          <div><span>売却済み平均</span><strong>{avg(sold) == null ? '—' : money(avg(sold))}</strong><small>{sold.length}件</small></div>
          <div><span>出品中平均</span><strong>{avg(listings) == null ? '—' : money(avg(listings))}</strong><small>{listings.length}件</small></div>
        </div>
        <button className="button primary" onClick={() => setShowPriceForm(v => !v)}><Plus size={16}/>価格情報を追加</button>
      </div>
    </div>
    {showPriceForm && <form className="form-card compact-form" onSubmit={addPrice}>
      <h3>価格情報を申請</h3>
      <div className="form-grid">
        <Field label="価格（円）"><input type="number" min="1" required value={form.price} onChange={e => setForm({...form, price:e.target.value})}/></Field>
        <Field label="価格区分"><select value={form.price_type} onChange={e => setForm({...form, price_type:e.target.value})}><option value="sold">実際に売れた</option><option value="listing">出品中</option></select></Field>
        <Field label="出典サイト"><input required value={form.source} onChange={e => setForm({...form, source:e.target.value})}/></Field>
        <Field label="確認日・売却日"><input type="date" value={form.transaction_date} onChange={e => setForm({...form, transaction_date:e.target.value})}/></Field>
      </div>
      <Field label="商品URL"><input type="url" value={form.source_url} onChange={e => setForm({...form, source_url:e.target.value})}/></Field>
      {error && <p className="error">{error}</p>}
      <button className="button primary" disabled={busy}>{busy ? '送信中...' : '申請する'}</button>
    </form>}
    <div className="history-grid">
      <PriceList title="実際に売れた価格" entries={sold}/>
      <PriceList title="出品中の価格" entries={listings}/>
    </div>
  </section>
}

function PriceList({ title, entries }) {
  return <div className="history-panel">
    <h3>{title} <span>{entries.length}件</span></h3>
    {entries.length ? entries.map(entry => <div className="price-row" key={entry.id}>
      <strong>{money(entry.price)}</strong>
      <span>{entry.source}</span>
      <small>{entry.transaction_date || new Date(entry.created_at).toLocaleDateString('ja-JP')}</small>
      {entry.source_url && <a href={entry.source_url} target="_blank" rel="noreferrer" aria-label="出典を開く"><ExternalLink size={14}/></a>}
    </div>) : <p className="muted">まだ登録がありません。</p>}
  </div>
}

function ReviewCard({ item, type, onReview }) {
  const isCard = type === 'card'
  return <div className="review-item">
    <div className="review-main">
      {isCard && <img src={cardImageUrl(item.image_path)} alt="" />}
      <div>
        <strong>{isCard ? item.card_name : item.cards?.card_name || 'カード'}</strong>
        <p>{isCard ? `${item.members?.name || ''} / ${item.albums?.name || 'アルバム未指定'} / ${item.benefit || ''}` : `${money(item.price)} / ${item.price_type === 'sold' ? '売却済み' : '出品中'} / ${item.source}`}</p>
        {!isCard && item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">出典を確認 <ExternalLink size={12}/></a>}
      </div>
    </div>
    <div className="review-actions">
      <button className="approve" onClick={() => onReview(isCard ? 'cards' : 'price_entries', item.id, 'approved')}><Check size={15}/>承認</button>
      <button className="reject" onClick={() => onReview(isCard ? 'cards' : 'price_entries', item.id, 'rejected')}><Ban size={15}/>却下</button>
    </div>
  </div>
}
