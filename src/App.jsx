import { useEffect, useMemo, useState } from 'react'
import {
  Search, ImagePlus, Plus, LogIn, LogOut, X, Check, Ban,
  Camera, RefreshCw, ExternalLink, ShieldCheck, UserRound,
  Disc3, Users, AlertCircle, Trash2, Save, Link2
} from 'lucide-react'
import { supabase, supabaseReady } from './lib/supabase'
import { prepareAndUploadImage } from './lib/imageUpload'
import { createImageHash, hashSimilarity } from './lib/imageHash'

const money = value => new Intl.NumberFormat('ja-JP', {
  style: 'currency', currency: 'JPY', maximumFractionDigits: 0
}).format(value)

const publicName = username =>
  typeof username === 'string' && username.trim()
    ? username.trim()
    : 'users'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [publicProfiles, setPublicProfiles] = useState([])
  const [cards, setCards] = useState([])
  const [groups, setGroups] = useState([])
  const [members, setMembers] = useState([])
  const [albums, setAlbums] = useState([])
  const [prices, setPrices] = useState([])
  const [pendingUsers, setPendingUsers] = useState([])
  const [pendingCards, setPendingCards] = useState([])
  const [pendingPrices, setPendingPrices] = useState([])
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
  const myPublicProfile = publicProfiles.find(
    item => item.id === session?.user?.id
  ) || null

  useEffect(() => {
    if (!supabaseReady) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession)
      }
    )

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabaseReady) return

    if (!session?.user) {
      setProfile(null)
      if (tab === 'mypage') setTab('browse')
      loadPublicData()
      return
    }

    loadProfile(session.user.id)
    loadPublicData()
  }, [session])

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, account_status, username')
      .eq('id', userId)
      .maybeSingle()

    if (error) setNotice(error.message)
    setProfile(data)
  }

  async function loadPublicData() {
    setLoading(true)

    const [g, m, a, c, p, pp] = await Promise.all([
      supabase.from('groups').select('*').order('name'),
      supabase.from('members').select('*').order('name'),
      supabase.from('albums').select('*').order('name'),
      supabase.from('cards')
        .select('*, members(name), albums(name), groups(name)')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('price_entries')
        .select('*')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase.from('public_profiles')
        .select('id, username')
    ])

    const errors = [g.error, m.error, a.error, c.error, p.error, pp.error]
      .filter(Boolean)

    if (errors.length) {
      setNotice(errors.map(error => error.message).join(' / '))
    }

    setGroups(g.data || [])
    setMembers(m.data || [])
    setAlbums(a.data || [])
    setCards(c.data || [])
    setPrices(p.data || [])
    setPublicProfiles(pp.data || [])
    setLoading(false)
  }

  function getPublicName(userId) {
    if (!userId) return '匿名'
    const found = publicProfiles.find(item => item.id === userId)
    return publicName(found?.username)
  }

  const visibleCards = useMemo(() => {
    let result = cards

    if (memberFilter) {
      result = result.filter(
        card => String(card.member_id) === memberFilter
      )
    }

    if (albumFilter) {
      result = result.filter(
        card => String(card.album_id) === albumFilter
      )
    }

    if (search.trim()) {
      const term = search.toLowerCase()

      result = result.filter(card =>
        [
          card.card_name,
          card.benefit,
          card.members?.name,
          card.albums?.name,
          card.groups?.name
        ]
          .filter(Boolean)
          .some(value => value.toLowerCase().includes(term))
      )
    }

    if (imageMatches) {
      const scores = new Map(
        imageMatches.map(item => [item.id, item.score])
      )

      result = [...result].sort(
        (a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0)
      )
    }

    return result
  }, [cards, memberFilter, albumFilter, search, imageMatches])

  async function signInOrSignUp(event) {
    event.preventDefault()

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') || '').trim()
    const password = String(form.get('password') || '')
    const enteredUsername = String(form.get('username') || '').trim()
    const username = enteredUsername || 'users'

    const result = authMode === 'signup'
      ? await supabase.auth.signUp({
          email,
          password,
          options: { data: { username } }
        })
      : await supabase.auth.signInWithPassword({
          email,
          password
        })

    if (result.error) {
      setNotice(result.error.message)
    } else {
      setNotice(
        authMode === 'signup'
          ? '登録メールを確認してください。確認後にログインできます。'
          : 'ログインしました。'
      )
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setNotice('ログアウトしました')
    setTab('browse')
    setSelectedCard(null)
  }

  async function updatePublicUsername(nextUsername) {
    if (!session?.user) return false

    const username = String(nextUsername || '').trim() || 'users'

    if (username.length > 24) {
      setNotice('ニックネームは24文字以内にしてください。')
      return false
    }

    const { error } = await supabase
      .from('public_profiles')
      .update({ username })
      .eq('id', session.user.id)

    if (error) {
      setNotice(`ニックネームを変更できませんでした：${error.message}`)
      return false
    }

    setPublicProfiles(current => {
      const exists = current.some(item => item.id === session.user.id)
      if (exists) {
        return current.map(item =>
          item.id === session.user.id ? { ...item, username } : item
        )
      }
      return [...current, { id: session.user.id, username }]
    })

    setNotice('公開ニックネームを変更しました。')
    return true
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
        .map(card => ({
          id: card.id,
          score: hashSimilarity(hash, card.image_hash)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)

      setImageMatches(ranked)

      setNotice(
        ranked.length
          ? '画像の見た目が近いカードを上位に表示しています。'
          : '比較できるカードがありません。'
      )
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
    const { data, error } = await supabase
      .from('price_entries')
      .select('*')
      .eq('card_id', cardId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })

    if (error) {
      setNotice(error.message)
      return []
    }

    return data || []
  }

  async function openCard(card) {
    const cardPrices = await loadCardPrices(card.id)
    setSelectedCard({ ...card, prices: cardPrices })
  }

  async function reviewItem(table, id, status) {
    const { error } = await supabase
      .from(table)
      .update({ status })
      .eq('id', id)

    if (error) {
      setNotice(error.message)
    } else {
      setNotice(status === 'approved' ? '承認しました' : '却下しました')
      await loadPublicData()
      await loadPending()
    }
  }

  async function loadPending() {
    const [c, p, u] = await Promise.all([
      supabase.from('cards')
        .select('*, members(name), albums(name), groups(name)')
        .eq('status', 'pending')
        .order('created_at'),
      supabase.from('price_entries')
        .select('*, cards(card_name, benefit, members(name))')
        .eq('status', 'pending')
        .order('created_at'),
      supabase.from('profiles')
        .select('*')
        .eq('account_status', 'pending')
        .order('created_at'),
    ])

    if (c.error || p.error || u.error) {
      setNotice(c.error?.message || p.error?.message || u.error?.message)
    }

    setPendingCards(c.data || [])
    setPendingPrices(p.data || [])
    setPendingUsers(u.data || [])
  }

  async function reviewUser(id, status) {
    const { error } = await supabase
      .from('profiles')
      .update({ account_status: status })
      .eq('id', id)

    if (error) {
      setNotice(error.message)
    } else {
      setNotice(status === 'approved'
        ? 'ユーザーを承認しました'
        : 'ユーザーを却下しました')
      await loadPending()
    }
  }

  async function deleteCard(card) {
    const confirmed = window.confirm(
      `「${card.card_name}」を削除しますか？\n関連する価格情報も削除されます。`
    )

    if (!confirmed) return

    const { error } = await supabase
      .from('cards')
      .delete()
      .eq('id', card.id)

    if (error) {
      setNotice(`カードを削除できませんでした：${error.message}`)
      return
    }

    if (card.image_path) {
      const { error: imageError } = await supabase.storage
        .from('card-images')
        .remove([card.image_path])

      if (imageError) {
        setNotice(
          `カードは削除しましたが、画像の削除に失敗しました：${imageError.message}`
        )
      } else {
        setNotice('カードと画像を削除しました')
      }
    } else {
      setNotice('カードを削除しました')
    }

    if (selectedCard?.id === card.id) {
      setSelectedCard(null)
    }

    await loadPublicData()
  }

  async function deletePrice(price) {
    const confirmed = window.confirm(
      `${money(price.price)}の価格情報を削除しますか？`
    )

    if (!confirmed) return

    const { error } = await supabase
      .from('price_entries')
      .delete()
      .eq('id', price.id)

    if (error) {
      setNotice(`価格情報を削除できませんでした：${error.message}`)
      return
    }

    setNotice('価格情報を削除しました')
    await loadPublicData()

    if (selectedCard?.id === price.card_id) {
      await openCard(selectedCard)
    }
  }

  useEffect(() => {
    if (isAdmin && tab === 'admin') {
      loadPending()
    }
  }, [isAdmin, tab])

  if (!supabaseReady) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <h1>Photocard Archive</h1>
          <p>Supabaseの接続情報がまだ設定されていません。</p>
          <p>
            <code>.env.local</code> を作成し、
            <code>.env.example</code> を参考にURLとPublishable keyを入力してください。
          </p>
        </div>
      </main>
    )
  }

  const myCards = cards.filter(card => card.submitted_by === session?.user?.id)
  const myPrices = prices.filter(price => price.user_id === session?.user?.id)

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={event => {
            event.preventDefault()
            setTab('browse')
            setSelectedCard(null)
          }}
        >
          <span className="brand-mark">P</span>
          <span>
            Photocard Archive
            <small>COMMUNITY DATABASE</small>
          </span>
        </a>

        <div className="top-actions">
          {session ? (
            <>
              <button
                className="user-label mypage-header-button"
                onClick={() => {
                  setTab('mypage')
                  setSelectedCard(null)
                }}
                title="マイページ"
              >
                <UserRound size={15}/>
                {publicName(myPublicProfile?.username)}
              </button>
              <button
                className="icon-button"
                onClick={signOut}
                title="ログアウト"
              >
                <LogOut size={17}/>
              </button>
            </>
          ) : (
            <button
              className="button small"
              onClick={() => setTab('auth')}
            >
              <LogIn size={16}/>ログイン
            </button>
          )}
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div>
            <p className="eyebrow">K-POP PHOTOCARD DATABASE</p>
            <h1>推しのトレカ相場を、<br/><em>みんなで記録。</em></h1>
            <p className="hero-copy">
              カードを探す、価格を記録する、みんなで情報を更新する。
            </p>
          </div>
          <div className="hero-stamp">
            <Disc3 size={42}/>
            <span>COMMUNITY<br/>ARCHIVE</span>
          </div>
        </section>

        <nav className="tabs">
          <button
            className={tab === 'browse' ? 'active' : ''}
            onClick={() => {
              setTab('browse')
              setSelectedCard(null)
            }}
          >
            <Search size={16}/>カードを探す
          </button>

          <button
            className={tab === 'submit' ? 'active' : ''}
            onClick={() => setTab('submit')}
          >
            <Plus size={16}/>登録する
          </button>

          {session && (
            <button
              className={tab === 'mypage' ? 'active' : ''}
              onClick={() => {
                setTab('mypage')
                setSelectedCard(null)
              }}
            >
              <UserRound size={16}/>マイページ
            </button>
          )}

          {isAdmin && (
            <button
              className={tab === 'admin' ? 'active' : ''}
              onClick={() => setTab('admin')}
            >
              <ShieldCheck size={16}/>管理者メニュー
            </button>
          )}

          {!session && (
            <button
              className={tab === 'auth' ? 'active' : ''}
              onClick={() => setTab('auth')}
            >
              <LogIn size={16}/>ログイン
            </button>
          )}
        </nav>

        {notice && (
          <div className="notice">
            <AlertCircle size={16}/>
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>
              <X size={15}/>
            </button>
          </div>
        )}

        {tab === 'auth' && (
          <AuthPanel
            mode={authMode}
            setMode={setAuthMode}
            onSubmit={signInOrSignUp}
          />
        )}

        {tab === 'mypage' && session && (
          <MyPage
            publicProfile={myPublicProfile}
            cards={myCards}
            prices={myPrices}
            allCards={cards}
            onSaveUsername={updatePublicUsername}
            onOpenCard={async card => {
              setTab('browse')
              await openCard(card)
            }}
            onSignOut={signOut}
          />
        )}

        {tab === 'browse' && !selectedCard && (
          <section>
            <div className="section-heading">
              <div>
                <p className="eyebrow">EXPLORE CARDS</p>
                <h2>トレカを探す</h2>
              </div>
              <span className="count">{visibleCards.length} CARDS</span>
            </div>

            <div className="search-panel">
              <label className="search-box">
                <Search size={18}/>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="カード名・特典名・メンバー名で検索"
                />
              </label>

              <div className="filter-row">
                <label>
                  <Users size={15}/>
                  <select
                    value={memberFilter}
                    onChange={e => setMemberFilter(e.target.value)}
                  >
                    <option value="">すべてのメンバー</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <Disc3 size={15}/>
                  <select
                    value={albumFilter}
                    onChange={e => setAlbumFilter(e.target.value)}
                  >
                    <option value="">すべてのアルバム</option>
                    {albums.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="image-search-row">
                <label className="button outline file-button">
                  <Camera size={16}/>
                  {imageSearching
                    ? '検索中...'
                    : '画像をアップロードして類似検索'}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={imageSearching}
                    onChange={e => searchByImage(e.target.files?.[0])}
                  />
                </label>

                {imageMatches && (
                  <button
                    className="text-button"
                    onClick={clearImageSearch}
                  >
                    <X size={14}/>画像検索を解除
                  </button>
                )}
              </div>

              {imageMatches && (
                <p className="hint">
                  画像の類似度順です。背景・角度・トリミングによって順位が変わることがあります。
                </p>
              )}
            </div>

            {loading ? (
              <div className="empty">
                <RefreshCw className="spin"/>読み込み中...
              </div>
            ) : visibleCards.length ? (
              <div className="card-grid">
                {visibleCards.map(card => (
                  <CardTile
                    key={card.id}
                    card={card}
                    authorName={getPublicName(card.submitted_by)}
                    prices={prices.filter(p => p.card_id === card.id)}
                    imageScore={imageMatches?.find(x => x.id === card.id)?.score}
                    onClick={() => openCard(card)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">
                <ImagePlus size={32}/>
                <strong>カードがまだありません</strong>
                <span>最初のトレカを登録してみましょう。</span>
              </div>
            )}
          </section>
        )}

        {tab === 'browse' && selectedCard && (
          <CardDetail
            card={selectedCard}
            onBack={() => setSelectedCard(null)}
            session={session}
            authorName={getPublicName(selectedCard.submitted_by)}
            getPublicName={getPublicName}
            onPriceAdded={() => openCard(selectedCard)}
          />
        )}

        {tab === 'submit' && (
          <SubmitPanel
            session={session}
            groups={groups}
            members={members}
            albums={albums}
            cards={cards}
            onDone={async () => {
              await loadPublicData()
              setTab('browse')
              setNotice('登録しました！投稿内容はすでに公開されています。')
            }}
          />
        )}

        {tab === 'admin' && isAdmin && (
          <section>
            <div className="section-heading">
              <div>
                <p className="eyebrow">MODERATION</p>
                <h2>管理者メニュー</h2>
              </div>
              <button
                className="button outline small"
                onClick={async () => {
                  await loadPublicData()
                  await loadPending()
                }}
              >
                <RefreshCw size={15}/>更新
              </button>
            </div>

            <p className="hint">
              公開済みのカード・価格情報を削除できます。削除した情報は元に戻せません。
            </p>

            <BiasroomImportPanel
              session={session}
              groups={groups}
              members={members}
              albums={albums}
              cards={cards}
              onDone={async () => {
                await loadPublicData()
                setNotice('Biasroom画像を登録しました。')
              }}
            />

            <h3 className="subheading">
              公開中のトレカ <span>{cards.length}</span>
            </h3>

            {cards.map(card => (
              <div className="review-item" key={card.id}>
                <div className="review-main">
                  <img src={cardImageUrl(card.image_path)} alt=""/>
                  <div>
                    <strong>{card.card_name}</strong>
                    <p>
                      {card.members?.name || '未分類'}
                      {' / '}
                      {card.albums?.name || 'アルバム未指定'}
                    </p>
                    <p>投稿者：{getPublicName(card.submitted_by)}</p>
                  </div>
                </div>
                <div className="review-actions">
                  <button
                    className="reject"
                    onClick={() => deleteCard(card)}
                  >
                    <Trash2 size={15}/>削除
                  </button>
                </div>
              </div>
            ))}

            {!cards.length && (
              <p className="muted">公開中のカードはありません。</p>
            )}

            <h3 className="subheading">
              公開中の価格情報 <span>{prices.length}</span>
            </h3>

            {prices.map(price => {
              const card = cards.find(c => c.id === price.card_id)

              return (
                <div className="review-item" key={price.id}>
                  <div className="review-main">
                    <div>
                      <strong>{money(price.price)}</strong>
                      <p>
                        {card?.members?.name || ''}
                        {' / '}
                        {card?.card_name || 'カード'}
                      </p>
                      <p>
                        {price.price_type === 'sold' ? '売却済み' : '出品中'}
                        {' / '}
                        {price.source}
                      </p>
                      <p>投稿者：{getPublicName(price.user_id)}</p>
                    </div>
                  </div>
                  <div className="review-actions">
                    <button
                      className="reject"
                      onClick={() => deletePrice(price)}
                    >
                      <Trash2 size={15}/>削除
                    </button>
                  </div>
                </div>
              )
            })}

            {!prices.length && (
              <p className="muted">公開中の価格情報はありません。</p>
            )}

            <h3 className="subheading">
              過去の承認待ちユーザー <span>{pendingUsers.length}</span>
            </h3>

            {pendingUsers.map(user => (
              <div className="review-card" key={user.id}>
                <strong>{publicName(user.username)}</strong>
                <div className="review-actions">
                  <button
                    className="approve"
                    onClick={() => reviewUser(user.id, 'approved')}
                  >
                    承認
                  </button>
                  <button
                    className="reject"
                    onClick={() => reviewUser(user.id, 'rejected')}
                  >
                    却下
                  </button>
                </div>
              </div>
            ))}

            {!pendingUsers.length && (
              <p className="muted">承認待ちユーザーはいません。</p>
            )}

            <h3 className="subheading">
              過去の承認待ちトレカ <span>{pendingCards.length}</span>
            </h3>

            {pendingCards.map(card => (
              <ReviewCard
                key={card.id}
                item={card}
                type="card"
                onReview={reviewItem}
              />
            ))}

            {!pendingCards.length && (
              <p className="muted">承認待ちのトレカはありません。</p>
            )}

            <h3 className="subheading">
              過去の承認待ち価格 <span>{pendingPrices.length}</span>
            </h3>

            {pendingPrices.map(price => (
              <ReviewCard
                key={price.id}
                item={price}
                type="price"
                onReview={reviewItem}
              />
            ))}

            {!pendingPrices.length && (
              <p className="muted">承認待ちの価格情報はありません。</p>
            )}
          </section>
        )}

        <footer>
          <span>PHOTOCARD ARCHIVE</span>
          <span>Community-powered price reference</span>
        </footer>
      </main>
    </div>
  )
}

function BiasroomImportPanel({ session, groups, members, albums, cards, onDone }) {
  const [imageUrl, setImageUrl] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [memberId, setMemberId] = useState('')
  const [albumId, setAlbumId] = useState('')
  const [cardName, setCardName] = useState('')
  const [benefit, setBenefit] = useState('')
  const [loadingImage, setLoadingImage] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const illitGroup = groups.find(group => group.name.toLowerCase() === 'illit')
  const illitMembers = members.filter(member =>
    illitGroup && String(member.group_id) === String(illitGroup.id)
  )
  const selectedMember = illitMembers.find(member => String(member.id) === memberId)
  const illitAlbums = albums.filter(album =>
    selectedMember && String(album.group_id) === String(selectedMember.group_id)
  )

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  async function loadOriginalImage() {
    setLoadingImage(true)
    setError('')
    setFile(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview('')

    try {
      const parsed = new URL(imageUrl.trim())
      const allowedHost = parsed.hostname === 'biasroomcdn.com' ||
        parsed.hostname.endsWith('.biasroomcdn.com')
      if (parsed.protocol !== 'https:' || !allowedHost) {
        throw new Error('biasroomcdn.com のHTTPS画像URLを入力してください。')
      }
      if (!session?.access_token) {
        throw new Error('管理者としてログインし直してください。')
      }

      const response = await fetch(
        import.meta.env.VITE_SUPABASE_URL + '/functions/v1/biasroom-image-proxy',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + session.access_token
          },
          body: JSON.stringify({ url: parsed.href })
        }
      )

      if (!response.ok) {
        let message = '画像を取得できませんでした。'
        try {
          const body = await response.json()
          if (body.error) message = body.error
        } catch {}
        throw new Error(message)
      }

      const blob = await response.blob()
      if (!blob.type.startsWith('image/')) {
        throw new Error('取得したデータが画像ではありません。')
      }
      const nextFile = new File([blob], 'biasroom-' + Date.now(), {
        type: blob.type
      })
      setFile(nextFile)
      setPreview(URL.createObjectURL(blob))
    } catch (e) {
      setError(e.message || '画像の読み込みに失敗しました。')
    } finally {
      setLoadingImage(false)
    }
  }

  async function registerCard(event) {
    event.preventDefault()
    if (!file || !selectedMember || !cardName.trim()) {
      setError('画像・メンバー・カード名を入力してください。')
      return
    }

    setSaving(true)
    setError('')
    let uploaded = null

    try {
      const hash = await createImageHash(file)
      const { data: duplicates, error: duplicateError } = await supabase
        .from('cards')
        .select('id, card_name')
        .eq('image_hash', hash)
        .limit(1)

      if (duplicateError) throw duplicateError
      if (duplicates?.length) {
        throw new Error('同じ画像のカードが既に登録されています（' + duplicates[0].card_name + '）。')
      }

      uploaded = await prepareAndUploadImage(file, session.user.id)
      const { error: insertError } = await supabase
        .from('cards')
        .insert({
          group_id: Number(selectedMember.group_id),
          member_id: Number(selectedMember.id),
          album_id: albumId ? Number(albumId) : null,
          card_name: cardName.trim(),
          benefit: benefit.trim() || null,
          image_path: uploaded.imagePath,
          image_hash: uploaded.imageHash,
          submitted_by: session.user.id,
          status: 'approved'
        })

      if (insertError) throw insertError

      setImageUrl('')
      setFile(null)
      setPreview('')
      setMemberId('')
      setAlbumId('')
      setCardName('')
      setBenefit('')
      await onDone()
    } catch (e) {
      if (uploaded?.imagePath) {
        await supabase.storage.from('card-images').remove([uploaded.imagePath])
      }
      setError(e.message || 'カード登録に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="form-card biasroom-import">
      <p className="eyebrow">ADMIN ONLY · ILLIT</p>
      <h2>Biasroom画像を登録</h2>
      <p className="hint">
        Biasroom CDNのOpen originalで開いた画像URLを読み込み、既存のカード一覧に登録します。
        取得元の利用条件と画像の再公開許可を確認した画像のみ登録してください。
      </p>

      <div className="biasroom-url-row">
        <Field label="Biasroom画像URL">
          <input
            type="url"
            value={imageUrl}
            onChange={event => setImageUrl(event.target.value)}
            placeholder="https://biasroomcdn.com/..."
          />
        </Field>
        <button
          className="button outline"
          type="button"
          disabled={loadingImage || !imageUrl.trim()}
          onClick={loadOriginalImage}
        >
          <Link2 size={15}/>
          {loadingImage ? '取得中...' : '画像を読み込む'}
        </button>
      </div>

      {preview && (
        <div className="biasroom-preview-wrap">
          <img className="upload-preview" src={preview} alt="取得したカード画像"/>
          <span>画像を取得しました</span>
        </div>
      )}

      <form className="form-stack" onSubmit={registerCard}>
        <Field label="ILLITメンバー">
          <select value={memberId} onChange={event => {
            setMemberId(event.target.value)
            setAlbumId('')
          }} required>
            <option value="">メンバーを選択</option>
            {illitMembers.map(member => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
        </Field>

        <Field label="アルバム（任意）">
          <select value={albumId} onChange={event => setAlbumId(event.target.value)}>
            <option value="">未指定・その他</option>
            {illitAlbums.map(album => (
              <option key={album.id} value={album.id}>{album.name}</option>
            ))}
          </select>
        </Field>

        <Field label="カード名">
          <input
            value={cardName}
            onChange={event => setCardName(event.target.value)}
            placeholder="例：Lucky Draw / POB / Album Photocard"
            required
          />
        </Field>

        <Field label="特典・タグなど（任意）">
          <input
            value={benefit}
            onChange={event => setBenefit(event.target.value)}
            placeholder="例：店舗名、ラウンド、バージョン"
          />
        </Field>

        {error && <p className="error">{error}</p>}

        <button className="button primary full" type="submit"
          disabled={saving || !file || !selectedMember || !cardName.trim()}>
          {saving ? 'Supabaseに登録中...' : 'この画像をカードとして登録'}
        </button>
      </form>
      <p className="hint">既存カードの画像ハッシュと照合し、同一画像の重複登録を防ぎます。</p>
    </section>
  )
}

function AuthPanel({ mode, setMode, onSubmit }) {
  return (
    <section className="form-card narrow">
      <p className="eyebrow">ACCOUNT</p>
      <h2>{mode === 'signup' ? 'アカウント作成' : 'ログイン'}</h2>

      <form onSubmit={onSubmit} className="form-stack">
        {mode === 'signup' && (
          <Field label="公開ニックネーム（任意）">
            <input
              name="username"
              maxLength="24"
              placeholder="未入力なら users と表示されます"
            />
          </Field>
        )}

        <Field label="メールアドレス">
          <input
            name="email"
            type="email"
            required
            placeholder="name@example.com"
          />
        </Field>

        <Field label="パスワード">
          <input
            name="password"
            type="password"
            minLength="6"
            required
            placeholder="6文字以上"
          />
        </Field>

        <button className="button primary full" type="submit">
          {mode === 'signup' ? 'アカウントを作成' : 'ログイン'}
        </button>
      </form>

      <button
        className="text-button switch-auth"
        onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}
      >
        {mode === 'signup'
          ? 'すでにアカウントを持っている'
          : '初めて利用する方はこちら'}
      </button>

      <p className="hint">
        公開されるのはニックネームのみです。メールアドレスは投稿者名として表示しません。
      </p>
    </section>
  )
}

function MyPage({
  publicProfile, cards, prices, allCards,
  onSaveUsername, onOpenCard, onSignOut
}) {
  const [username, setUsername] = useState(publicProfile?.username || 'users')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setUsername(publicName(publicProfile?.username))
  }, [publicProfile?.username])

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    await onSaveUsername(username)
    setSaving(false)
  }

  return (
    <section className="mypage">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR ACCOUNT</p>
          <h2>マイページ</h2>
        </div>
        <span className="count">MY PAGE</span>
      </div>

      <div className="form-card mypage-profile">
        <div className="mypage-profile-heading">
          <UserRound size={25}/>
          <div>
            <strong>{publicName(publicProfile?.username)}</strong>
            <span>公開プロフィール</span>
          </div>
        </div>

        <form className="form-stack" onSubmit={save}>
          <Field label="公開ニックネーム">
            <input
              value={username}
              onChange={event => setUsername(event.target.value)}
              maxLength="24"
              placeholder="users"
            />
          </Field>
          <p className="hint">
            この名前は、カードや価格情報の投稿者欄に表示されます。メールアドレスは公開されません。
          </p>
          <button className="button primary" type="submit" disabled={saving}>
            <Save size={16}/>{saving ? '保存中...' : 'ニックネームを保存'}
          </button>
        </form>
      </div>

      <div className="mypage-stats">
        <div><strong>{cards.length}</strong><span>カード投稿</span></div>
        <div><strong>{prices.length}</strong><span>価格投稿</span></div>
      </div>

      <div className="mypage-section">
        <h3>自分が登録したカード <span>{cards.length}件</span></h3>
        {cards.length ? cards.map(card => (
          <button
            className="mypage-entry"
            key={card.id}
            onClick={() => onOpenCard(card)}
          >
            <img src={cardImageUrl(card.image_path)} alt=""/>
            <span>
              <strong>{card.card_name}</strong>
              <small>{card.members?.name || '未分類'} / {card.albums?.name || 'アルバム未指定'}</small>
            </span>
            <ExternalLink size={15}/>
          </button>
        )) : <p className="muted">まだカードを投稿していません。</p>}
      </div>

      <div className="mypage-section">
        <h3>自分が登録した価格情報 <span>{prices.length}件</span></h3>
        {prices.length ? prices.map(price => {
          const card = allCards.find(item => item.id === price.card_id)
          return (
            <div className="mypage-price-entry" key={price.id}>
              <div>
                <strong>{money(price.price)}</strong>
                <small>{card?.card_name || 'カード情報なし'}</small>
              </div>
              <span>{price.price_type === 'sold' ? '売却済み' : '出品中'}</span>
            </div>
          )
        }) : <p className="muted">まだ価格情報を投稿していません。</p>}
      </div>

      <button className="button outline mypage-logout" onClick={onSignOut}>
        <LogOut size={16}/>ログアウト
      </button>
    </section>
  )
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function SubmitPanel({
  session, groups, members, albums, cards, onDone
}) {
  const [kind, setKind] = useState('card')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cardId, setCardId] = useState('')

  const [form, setForm] = useState({
    group_id: '',
    member_id: '',
    album_id: '',
    card_name: '',
    benefit: '',
    price: '',
    price_type: 'sold',
    source: 'メルカリ',
    source_url: '',
    transaction_date: ''
  })

  function update(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function chooseFile(nextFile) {
    setFile(nextFile)

    if (preview) URL.revokeObjectURL(preview)

    setPreview(nextFile ? URL.createObjectURL(nextFile) : '')
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')

    let uploaded = null

    try {
      if (kind === 'card') {
        if (!file) {
          throw new Error('カード画像を選択してください')
        }

        uploaded = await prepareAndUploadImage(
          file,
          session?.user?.id || null
        )

        const { data: userData, error: userError } =
          await supabase.auth.getUser();

        if (userError || !userData.user) {
          alert('ログイン情報を取得できません。再ログインしてください。');
          return;
        }
        
        const { error: insertError } = await supabase
          .from('cards')
          .insert({
            group_id: Number(form.group_id),
            member_id: Number(form.member_id),
            album_id: form.album_id ? Number(form.album_id) : null,
            card_name: form.card_name.trim(),
            benefit: form.benefit.trim() || null,
            image_path: uploaded.imagePath,
            image_hash: uploaded.imageHash,
            submitted_by: userData.user.id,
            status: 'approved'
          })

        if (insertError) {
          console.error('カード投稿エラー:', insertError)
          throw new Error([
            insertError.message,
            insertError.details,
            insertError.hint,
            insertError.code
          ].filter(Boolean).join(' / '))
        }
      } else {
        if (!cardId) {
          throw new Error('対象のカードを選択してください')
        }

        const { error: insertError } = await supabase
          .from('price_entries')
          .insert({
            card_id: Number(cardId),
            user_id: session?.user?.id || null,
            price: Number(form.price),
            price_type: form.price_type,
            source: form.source.trim(),
            source_url: form.source_url.trim() || null,
            transaction_date: form.transaction_date || null,
            status: 'approved'
          })

        if (insertError) throw insertError
      }

      await onDone()
    } catch (e) {
      if (uploaded?.imagePath) {
        await supabase.storage
          .from('card-images')
          .remove([uploaded.imagePath])
      }

      setError(e.message || '登録に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="form-card">
      <p className="eyebrow">CONTRIBUTE</p>
      <h2>情報を登録する</h2>
      <p className="hint">
        ログインせずに投稿できます。投稿した情報はすぐに公開されます。
        ログイン中の投稿には公開ニックネームが表示されます。
      </p>

      <div className="segmented">
        <button
          className={kind === 'card' ? 'selected' : ''}
          onClick={() => setKind('card')}
          type="button"
        >
          新しいトレカ
        </button>
        <button
          className={kind === 'price' ? 'selected' : ''}
          onClick={() => setKind('price')}
          type="button"
        >
          価格情報
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <form className="form-stack" onSubmit={submit}>
        {kind === 'card' ? (
          <>
            <Field label="カード画像（必須）">
              <input
                type="file"
                accept="image/*"
                onChange={e => chooseFile(e.target.files?.[0] || null)}
                required
              />
            </Field>

            {preview && (
              <img
                className="upload-preview"
                src={preview}
                alt="アップロード画像プレビュー"
              />
            )}

            <p className="hint">
              画像はブラウザ内でWebPに圧縮してから保存します。
              目安は最大幅1,400px・約250KBです。
            </p>

            <Field label="グループ">
              <select
                value={form.group_id}
                onChange={e => update('group_id', e.target.value)}
                required
              >
                <option value="">選択してください</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>

            <Field label="メンバー">
              <select
                value={form.member_id}
                onChange={e => update('member_id', e.target.value)}
                required
              >
                <option value="">選択してください</option>
                {members
                  .filter(m =>
                    !form.group_id ||
                    String(m.group_id) === form.group_id
                  )
                  .map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
              </select>
            </Field>

            <Field label="アルバム">
              <select
                value={form.album_id}
                onChange={e => update('album_id', e.target.value)}
              >
                <option value="">未指定・その他</option>
                {albums
                  .filter(a =>
                    !form.group_id ||
                    String(a.group_id) === form.group_id
                  )
                  .map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
              </select>
            </Field>

            <Field label="カード名">
              <input
                value={form.card_name}
                onChange={e => update('card_name', e.target.value)}
                required
                placeholder="例：特典トレカ / ラキドロ など"
              />
            </Field>

            <Field label="特典・バージョンなど">
              <input
                value={form.benefit}
                onChange={e => update('benefit', e.target.value)}
                placeholder="例：Weverse特典、店舗名、イベント名"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="対象カード">
              <select
                value={cardId}
                onChange={e => setCardId(e.target.value)}
                required
              >
                <option value="">カードを選択</option>
                {cards.map(card => (
                  <option key={card.id} value={card.id}>
                    {card.members?.name || '未分類'}
                    {' / '}
                    {card.card_name}
                  </option>
                ))}
              </select>
            </Field>

            {!cards.length && (
              <p className="hint">
                まだ登録済みのカードがありません。先にカードを登録してください。
              </p>
            )}

            <Field label="価格（円）">
              <input
                type="number"
                min="1"
                step="1"
                value={form.price}
                onChange={e => update('price', e.target.value)}
                required
                placeholder="1500"
              />
            </Field>

            <Field label="価格区分">
              <select
                value={form.price_type}
                onChange={e => update('price_type', e.target.value)}
              >
                <option value="sold">実際に売れた価格</option>
                <option value="listing">出品中の価格</option>
              </select>
            </Field>

            <Field label="出典サイト">
              <input
                value={form.source}
                onChange={e => update('source', e.target.value)}
                required
                placeholder="メルカリ / Yahoo!フリマ / X など"
              />
            </Field>

            <Field label="商品URL">
              <input
                type="url"
                value={form.source_url}
                onChange={e => update('source_url', e.target.value)}
                placeholder="https://..."
              />
            </Field>

            <Field label="売却日・確認日">
              <input
                type="date"
                value={form.transaction_date}
                onChange={e => update('transaction_date', e.target.value)}
              />
            </Field>
          </>
        )}

        <button
          className="button primary full"
          disabled={busy}
          type="submit"
        >
          {busy
            ? '送信中...'
            : kind === 'card'
              ? 'カードを公開する'
              : '価格情報を公開する'}
        </button>
      </form>
    </section>
  )
}

function CardTile({ card, prices, imageScore, onClick, authorName }) {
  const sold = prices
    .filter(p => p.price_type === 'sold')
    .map(p => p.price)

  const listings = prices
    .filter(p => p.price_type === 'listing')
    .map(p => p.price)

  const median = values => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
  }

  return (
    <button className="card-tile" onClick={onClick}>
      <div className="card-image-wrap">
        <img
          src={cardImageUrl(card.image_path)}
          alt={card.card_name}
          loading="lazy"
        />
        {imageScore != null && (
          <span className="similarity">
            {Math.round(imageScore * 100)}% match
          </span>
        )}
      </div>

      <div className="tile-info">
        <span className="tile-member">
          {card.members?.name || '未分類'}
        </span>
        <strong>{card.card_name}</strong>
        {card.benefit && (
          <span className="tile-benefit">{card.benefit}</span>
        )}
        <span className="tile-author">投稿者：{authorName}</span>
        <div className="tile-prices">
          <span>
            売却 {median(sold) == null ? '—' : money(median(sold))}
          </span>
          <span>
            出品 {median(listings) == null ? '—' : money(median(listings))}
          </span>
        </div>
      </div>
    </button>
  )
}

function cardImageUrl(path) {
  if (!path) return ''

  const { data } = supabase.storage
    .from('card-images')
    .getPublicUrl(path)

  return data.publicUrl
}

function CardDetail({
  card, onBack, onPriceAdded, session, authorName, getPublicName
}) {
  const [showPriceForm, setShowPriceForm] = useState(false)
  const [form, setForm] = useState({
    price: '',
    price_type: 'sold',
    source: 'メルカリ',
    source_url: '',
    transaction_date: ''
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sold = card.prices.filter(p => p.price_type === 'sold')
  const listings = card.prices.filter(p => p.price_type === 'listing')

  const avg = values => values.length
    ? Math.round(values.reduce((a, p) => a + p.price, 0) / values.length)
    : null

  async function addPrice(event) {
    event.preventDefault()
    setBusy(true)
    setError('')

    const { error: insertError } = await supabase
      .from('price_entries')
      .insert({
        card_id: card.id,
        user_id: session?.user?.id || null,
        price: Number(form.price),
        price_type: form.price_type,
        source: form.source.trim(),
        source_url: form.source_url.trim() || null,
        transaction_date: form.transaction_date || null,
        status: 'approved'
      })

    setBusy(false)

    if (insertError) {
      setError(insertError.message)
    } else {
      setShowPriceForm(false)
      setError('')
      await onPriceAdded()
    }
  }

  return (
    <section>
      <button className="back-button" onClick={onBack}>
        ← カード一覧に戻る
      </button>

      <div className="detail-layout">
        <img
          className="detail-image"
          src={cardImageUrl(card.image_path)}
          alt={card.card_name}
        />

        <div className="detail-copy">
          <p className="eyebrow">
            {card.groups?.name}
            {' / '}
            {card.albums?.name || 'アルバム未指定'}
          </p>

          <h2>{card.members?.name} – {card.card_name}</h2>

          {card.benefit && (
            <p className="muted">{card.benefit}</p>
          )}
          <p className="detail-author">カード投稿者：{authorName}</p>

          <div className="price-summary">
            <div>
              <span>売却済み平均</span>
              <strong>
                {avg(sold) == null ? '—' : money(avg(sold))}
              </strong>
              <small>{sold.length}件</small>
            </div>
            <div>
              <span>出品中平均</span>
              <strong>
                {avg(listings) == null ? '—' : money(avg(listings))}
              </strong>
              <small>{listings.length}件</small>
            </div>
          </div>

          <button
            className="button primary"
            onClick={() => setShowPriceForm(v => !v)}
          >
            <Plus size={16}/>価格情報を追加
          </button>
        </div>
      </div>

      {showPriceForm && (
        <form
          className="form-card compact-form"
          onSubmit={addPrice}
        >
          <h3>価格情報を登録</h3>

          <div className="form-grid">
            <Field label="価格（円）">
              <input
                type="number"
                min="1"
                required
                value={form.price}
                onChange={e => setForm({
                  ...form,
                  price: e.target.value
                })}
              />
            </Field>

            <Field label="価格区分">
              <select
                value={form.price_type}
                onChange={e => setForm({
                  ...form,
                  price_type: e.target.value
                })}
              >
                <option value="sold">実際に売れた</option>
                <option value="listing">出品中</option>
              </select>
            </Field>

            <Field label="出典サイト">
              <input
                required
                value={form.source}
                onChange={e => setForm({
                  ...form,
                  source: e.target.value
                })}
              />
            </Field>

            <Field label="確認日・売却日">
              <input
                type="date"
                value={form.transaction_date}
                onChange={e => setForm({
                  ...form,
                  transaction_date: e.target.value
                })}
              />
            </Field>
          </div>

          <Field label="商品URL">
            <input
              type="url"
              value={form.source_url}
              onChange={e => setForm({
                ...form,
                source_url: e.target.value
              })}
            />
          </Field>

          {error && <p className="error">{error}</p>}

          <button className="button primary" disabled={busy}>
            {busy ? '送信中...' : '価格情報を公開する'}
          </button>
        </form>
      )}

      <div className="history-grid">
        <PriceList
          title="実際に売れた価格"
          entries={sold}
          getPublicName={getPublicName}
        />
        <PriceList
          title="出品中の価格"
          entries={listings}
          getPublicName={getPublicName}
        />
      </div>
    </section>
  )
}

function PriceList({ title, entries, getPublicName }) {
  return (
    <div className="history-panel">
      <h3>{title} <span>{entries.length}件</span></h3>

      {entries.length ? (
        entries.map(entry => (
          <div className="price-row" key={entry.id}>
            <strong>{money(entry.price)}</strong>
            <span>{entry.source}</span>
            <small>
              {entry.transaction_date ||
                new Date(entry.created_at).toLocaleDateString('ja-JP')}
            </small>
            <small className="price-author">
              投稿者：{getPublicName(entry.user_id)}
            </small>

            {entry.source_url && (
              <a
                href={entry.source_url}
                target="_blank"
                rel="noreferrer"
                aria-label="出典を開く"
              >
                <ExternalLink size={14}/>
              </a>
            )}
          </div>
        ))
      ) : (
        <p className="muted">まだ登録がありません。</p>
      )}
    </div>
  )
}

function ReviewCard({ item, type, onReview }) {
  const isCard = type === 'card'

  return (
    <div className="review-item">
      <div className="review-main">
        {isCard && (
          <img src={cardImageUrl(item.image_path)} alt=""/>
        )}

        <div>
          <strong>
            {isCard
              ? item.card_name
              : item.cards?.card_name || 'カード'}
          </strong>

          <p>
            {isCard
              ? `${item.members?.name || ''} / ${item.albums?.name || 'アルバム未指定'} / ${item.benefit || ''}`
              : `${money(item.price)} / ${item.price_type === 'sold' ? '売却済み' : '出品中'} / ${item.source}`}
          </p>

          {!isCard && item.source_url && (
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer"
            >
              出典を確認 <ExternalLink size={12}/>
            </a>
          )}
        </div>
      </div>

      <div className="review-actions">
        <button
          className="approve"
          onClick={() => onReview(
            isCard ? 'cards' : 'price_entries',
            item.id,
            'approved'
          )}
        >
          <Check size={15}/>承認
        </button>

        <button
          className="reject"
          onClick={() => onReview(
            isCard ? 'cards' : 'price_entries',
            item.id,
            'rejected'
          )}
        >
          <Ban size={15}/>却下
        </button>
      </div>
    </div>
  )
}
