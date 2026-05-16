import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

interface Brand   { id: string; name: string; supplier_name: string | null }
interface Flavor  { id: string; name: string; brand_id: string }
interface Product {
  id: string; name: string; sku_code: string | null; unit_price: number
  description: string | null; status: string; flavor_id: string; image_url: string | null
}

export default function ProductsPage() {
  const [brands,      setBrands]      = useState<Brand[]>([])
  const [flavors,     setFlavors]     = useState<Flavor[]>([])
  const [products,    setProducts]    = useState<Product[]>([])
  const [selBrand,    setSelBrand]    = useState<Brand | null>(null)
  const [selFlavor,   setSelFlavor]   = useState<Flavor | null>(null)

  // Brand form
  const [newBrandName,     setNewBrandName]     = useState('')
  const [newBrandSupplier, setNewBrandSupplier] = useState('')
  const [editingBrand,     setEditingBrand]     = useState<Brand | null>(null)
  const [showBrandForm,    setShowBrandForm]    = useState(false)

  // Flavor form
  const [newFlavorName,  setNewFlavorName]  = useState('')
  const [editingFlavor,  setEditingFlavor]  = useState<Flavor | null>(null)
  const [showFlavorForm, setShowFlavorForm] = useState(false)

  // Product form
  const [showProductForm, setShowProductForm] = useState(false)
  const [editingProduct,  setEditingProduct]  = useState<Product | null>(null)
  const [prodName,        setProdName]        = useState('')
  const [prodSKU,         setProdSKU]         = useState('')
  const [prodPrice,       setProdPrice]       = useState('')
  const [prodDesc,        setProdDesc]        = useState('')
  const [prodStatus,      setProdStatus]      = useState('active')
  const [prodImage,       setProdImage]       = useState<File | null>(null)
  const [prodImageURL,    setProdImageURL]    = useState<string | null>(null)
  const [uploading,       setUploading]       = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [error,           setError]           = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    const [b, f, p] = await Promise.all([
      supabase.from('brands').select('*').order('name'),
      supabase.from('flavors').select('*').order('name'),
      supabase.from('products').select('*').order('name'),
    ])
    if (b.data) setBrands(b.data)
    if (f.data) setFlavors(f.data)
    if (p.data) setProducts(p.data)
  }

  // ── Brand ──────────────────────────────────────────────────────────────────
  const saveBrand = async () => {
    if (!newBrandName.trim()) return
    if (editingBrand) {
      const { data } = await supabase.from('brands')
        .update({ name: newBrandName.trim(), supplier_name: newBrandSupplier.trim() || null })
        .eq('id', editingBrand.id).select().single()
      if (data) setBrands(brands.map((b) => b.id === data.id ? data : b))
    } else {
      const { data } = await supabase.from('brands')
        .insert({ name: newBrandName.trim(), supplier_name: newBrandSupplier.trim() || null })
        .select().single()
      if (data) setBrands([...brands, data])
    }
    setNewBrandName(''); setNewBrandSupplier(''); setEditingBrand(null); setShowBrandForm(false)
  }

  const startEditBrand = (b: Brand) => {
    setEditingBrand(b); setNewBrandName(b.name); setNewBrandSupplier(b.supplier_name || '')
    setShowBrandForm(true)
  }

  const deleteBrand = async (id: string) => {
    if (!confirm('Delete this brand and all its flavors and products?')) return
    await supabase.from('brands').delete().eq('id', id)
    setBrands(brands.filter((b) => b.id !== id))
    setFlavors(flavors.filter((f) => {
      const flavorBrandId = flavors.find((fl) => fl.id === f.id)
      return true
    }))
    if (selBrand?.id === id) { setSelBrand(null); setSelFlavor(null) }
  }

  // ── Flavor ────────────────────────────────────────────────────────────────
  const saveFlavor = async () => {
    if (!newFlavorName.trim() || !selBrand) return
    if (editingFlavor) {
      const { data } = await supabase.from('flavors')
        .update({ name: newFlavorName.trim() }).eq('id', editingFlavor.id).select().single()
      if (data) setFlavors(flavors.map((f) => f.id === data.id ? data : f))
    } else {
      const { data } = await supabase.from('flavors')
        .insert({ name: newFlavorName.trim(), brand_id: selBrand.id }).select().single()
      if (data) setFlavors([...flavors, data])
    }
    setNewFlavorName(''); setEditingFlavor(null); setShowFlavorForm(false)
  }

  const deleteFlavor = async (id: string) => {
    if (!confirm('Delete this flavour and all its products?')) return
    await supabase.from('flavors').delete().eq('id', id)
    setFlavors(flavors.filter((f) => f.id !== id))
    if (selFlavor?.id === id) setSelFlavor(null)
  }

  // ── Product ───────────────────────────────────────────────────────────────
  const openNewProduct = () => {
    setEditingProduct(null); setProdName(''); setProdSKU(''); setProdPrice('')
    setProdDesc(''); setProdStatus('active'); setProdImage(null); setProdImageURL(null)
    setError(''); setShowProductForm(true)
  }

  const openEditProduct = (p: Product) => {
    setEditingProduct(p); setProdName(p.name); setProdSKU(p.sku_code || '')
    setProdPrice(String(p.unit_price)); setProdDesc(p.description || '')
    setProdStatus(p.status); setProdImage(null); setProdImageURL(p.image_url)
    setError(''); setShowProductForm(true)
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setProdImage(file)
    setUploading(true)
    try {
      const ext  = file.name.split('.').pop()
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage.from('product-images').upload(path, file)
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(path)
      setProdImageURL(publicUrl)
    } catch (err: unknown) {
      setError(`Image upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
    setUploading(false)
  }

  const saveProduct = async () => {
    if (!prodName.trim() || !selFlavor) return setError('Product name required')
    if (!prodPrice || isNaN(parseFloat(prodPrice))) return setError('Valid price required')
    setSaving(true); setError('')
    const payload = {
      name:        prodName.trim(),
      sku_code:    prodSKU.trim()  || null,
      unit_price:  parseFloat(prodPrice),
      description: prodDesc.trim() || null,
      status:      prodStatus,
      flavor_id:   selFlavor.id,
      image_url:   prodImageURL    || null,
    }
    if (editingProduct) {
      const { data } = await supabase.from('products').update(payload).eq('id', editingProduct.id).select().single()
      if (data) setProducts(products.map((p) => p.id === data.id ? data : p))
    } else {
      const { data } = await supabase.from('products').insert(payload).select().single()
      if (data) setProducts([...products, data])
    }
    setSaving(false); setShowProductForm(false)
  }

  const deleteProduct = async (id: string) => {
    if (!confirm('Delete this product?')) return
    await supabase.from('products').delete().eq('id', id)
    setProducts(products.filter((p) => p.id !== id))
    if (showProductForm && editingProduct?.id === id) setShowProductForm(false)
  }

  const brandFlavors   = flavors.filter((f) => f.brand_id === selBrand?.id)
  const flavorProducts = products.filter((p) => p.flavor_id === selFlavor?.id)

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-xl font-semibold text-slate-900 mb-6">Products</h1>

        <div className="flex gap-5">
          {/* ── Left panel — Brands + Flavors ── */}
          <div className="w-64 shrink-0 space-y-4">
            {/* Brands */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                <p className="text-sm font-semibold text-slate-900">Brands</p>
                <button onClick={() => { setShowBrandForm(true); setEditingBrand(null); setNewBrandName(''); setNewBrandSupplier('') }}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Add</button>
              </div>

              {showBrandForm && (
                <div className="p-3 bg-slate-50 border-b border-slate-200 space-y-2">
                  <input value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)}
                    placeholder="Brand name *"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={newBrandSupplier} onChange={(e) => setNewBrandSupplier(e.target.value)}
                    placeholder="Supplier name (optional)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <div className="flex gap-2">
                    <button onClick={() => { setShowBrandForm(false); setEditingBrand(null) }}
                      className="flex-1 py-1.5 border border-slate-300 rounded-lg text-xs hover:bg-slate-100">Cancel</button>
                    <button onClick={saveBrand} disabled={!newBrandName.trim()}
                      className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">
                      {editingBrand ? 'Update' : 'Add Brand'}
                    </button>
                  </div>
                </div>
              )}

              <div className="divide-y divide-slate-100">
                {brands.map((b) => (
                  <div key={b.id}
                    onClick={() => { setSelBrand(b); setSelFlavor(null); setShowProductForm(false) }}
                    className={`px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${selBrand?.id === b.id ? 'bg-blue-50 border-l-2 border-blue-600' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 truncate">{b.name}</p>
                        {b.supplier_name && (
                          <p className="text-xs text-slate-400 truncate mt-0.5">{b.supplier_name}</p>
                        )}
                        <p className="text-xs text-slate-400">
                          {flavors.filter((f) => f.brand_id === b.id).length} flavour(s)
                        </p>
                      </div>
                      <div className="flex gap-1 ml-2 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); startEditBrand(b) }}
                          className="text-xs text-blue-500 hover:text-blue-700 px-1">✏</button>
                        <button onClick={(e) => { e.stopPropagation(); deleteBrand(b.id) }}
                          className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                      </div>
                    </div>
                  </div>
                ))}
                {!brands.length && (
                  <p className="px-4 py-6 text-xs text-slate-400 text-center">No brands yet</p>
                )}
              </div>
            </div>

            {/* Flavors */}
            {selBrand && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                  <p className="text-sm font-semibold text-slate-900">Flavours</p>
                  <button onClick={() => { setShowFlavorForm(true); setEditingFlavor(null); setNewFlavorName('') }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Add</button>
                </div>

                {showFlavorForm && (
                  <div className="p-3 bg-slate-50 border-b border-slate-200 space-y-2">
                    <input value={newFlavorName} onChange={(e) => setNewFlavorName(e.target.value)}
                      placeholder="Flavour name"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <div className="flex gap-2">
                      <button onClick={() => { setShowFlavorForm(false); setEditingFlavor(null) }}
                        className="flex-1 py-1.5 border border-slate-300 rounded-lg text-xs hover:bg-slate-100">Cancel</button>
                      <button onClick={saveFlavor} disabled={!newFlavorName.trim()}
                        className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">
                        {editingFlavor ? 'Update' : 'Add'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="divide-y divide-slate-100">
                  {brandFlavors.map((f) => (
                    <div key={f.id}
                      onClick={() => { setSelFlavor(f); setShowProductForm(false) }}
                      className={`px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${selFlavor?.id === f.id ? 'bg-blue-50 border-l-2 border-blue-600' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{f.name}</p>
                          <p className="text-xs text-slate-400">
                            {products.filter((p) => p.flavor_id === f.id).length} product(s)
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={(e) => { e.stopPropagation(); setEditingFlavor(f); setNewFlavorName(f.name); setShowFlavorForm(true) }}
                            className="text-xs text-blue-500 hover:text-blue-700 px-1">✏</button>
                          <button onClick={(e) => { e.stopPropagation(); deleteFlavor(f.id) }}
                            className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!brandFlavors.length && (
                    <p className="px-4 py-6 text-xs text-slate-400 text-center">No flavours yet</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Right panel — Products ── */}
          <div className="flex-1">
            {!selFlavor ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <p className="text-4xl mb-3">📦</p>
                <p className="text-slate-700 font-medium">Select a brand then a flavour</p>
                <p className="text-slate-400 text-sm mt-1">Products will appear here</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Header with brand info */}
                <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{selBrand?.name} — {selFlavor.name}</p>
                    {selBrand?.supplier_name && (
                      <p className="text-xs text-slate-500 mt-0.5">Supplier: {selBrand.supplier_name}</p>
                    )}
                    <p className="text-xs text-slate-400">{flavorProducts.length} product(s)</p>
                  </div>
                  <button onClick={openNewProduct}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                    + Add Product
                  </button>
                </div>

                {/* Product form */}
                {showProductForm && (
                  <div className="bg-white rounded-xl border border-blue-300 p-5">
                    <h3 className="font-semibold text-slate-900 mb-4">
                      {editingProduct ? 'Edit Product' : 'New Product'}
                    </h3>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="col-span-2">
                        <label className="block text-xs text-slate-500 mb-1">Product Name *</label>
                        <input value={prodName} onChange={(e) => setProdName(e.target.value)}
                          placeholder="e.g. Sunchips Paprika 28g"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">SKU Code</label>
                        <input value={prodSKU} onChange={(e) => setProdSKU(e.target.value)}
                          placeholder="Optional"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Unit Price (ETB) *</label>
                        <input type="number" value={prodPrice} onChange={(e) => setProdPrice(e.target.value)}
                          placeholder="0.00"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-slate-500 mb-1">Description</label>
                        <input value={prodDesc} onChange={(e) => setProdDesc(e.target.value)}
                          placeholder="Optional"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Status</label>
                        <select value={prodStatus} onChange={(e) => setProdStatus(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Product Image</label>
                        <div onClick={() => fileRef.current?.click()}
                          className="w-full h-20 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                          {prodImageURL ? (
                            <img src={prodImageURL} alt="" className="h-16 w-16 object-contain rounded" />
                          ) : uploading ? (
                            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <span className="text-xs text-slate-400">Click to upload</span>
                          )}
                        </div>
                        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                      </div>
                    </div>
                    {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
                    <div className="flex gap-3">
                      <button onClick={() => setShowProductForm(false)}
                        className="flex-1 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                      <button onClick={saveProduct} disabled={saving || uploading}
                        className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {saving ? 'Saving…' : editingProduct ? 'Update' : 'Add Product'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Product list */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>{['Image','Product','SKU','Price','Status',''].map((h) =>
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {flavorProducts.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            {p.image_url ? (
                              <img src={p.image_url} alt={p.name} className="w-10 h-10 rounded-lg object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-slate-200 flex items-center justify-center text-lg">📦</div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                          <td className="px-4 py-3 text-slate-500 font-mono text-xs">{p.sku_code || '—'}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            ETB {p.unit_price.toLocaleString('en', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                            }`}>{p.status}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button onClick={() => openEditProduct(p)}
                                className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
                              <button onClick={() => deleteProduct(p.id)}
                                className="text-xs text-red-500 hover:text-red-700">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!flavorProducts.length && (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No products yet — click + Add Product</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
