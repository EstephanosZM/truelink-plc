import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { Brand, Flavor, Product } from '../types'

export default function ProductsPage() {
  const { brands, setBrands, flavors, setFlavors, products, setProducts } = useStore()
  const [activeBrand,  setActiveBrand]  = useState<string|null>(null)
  const [activeFlavor, setActiveFlavor] = useState<string|null>(null)
  const [view, setView] = useState<'brands'|'flavors'|'products'|'add-brand'|'add-flavor'|'add-product'|'edit-product'>('brands')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Brand form
  const [bName, setBName] = useState('')
  // Flavor form
  const [fName, setFName] = useState('')
  // Product form
  const [pBrandId,   setPBrandId]   = useState('')
  const [pFlavorId,  setPFlavorId]  = useState('')
  const [pName,      setPName]      = useState('')
  const [pSku,       setPSku]       = useState('')
  const [pPrice,     setPPrice]     = useState('')
  const [pDesc,      setPDesc]      = useState('')
  const [pStatus,    setPStatus]    = useState('active')
  const [editingId,  setEditingId]  = useState<string|null>(null)

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

  const saveBrand = async () => {
    if (!bName.trim()) return setError('Brand name is required')
    setSaving(true); setError('')
    const { data, error } = await supabase.from('brands').insert({ name: bName.trim() }).select().single()
    setSaving(false)
    if (error) { setError(error.message); return }
    setBrands([...brands, data]); setBName(''); setView('brands')
  }

  const deleteBrand = async (id: string) => {
    if (!confirm('Delete this brand and all its flavors and products?')) return
    await supabase.from('brands').delete().eq('id', id)
    setBrands(brands.filter((b) => b.id !== id))
    setFlavors(flavors.filter((f) => f.brand_id !== id))
    setProducts(products.filter((p) => p.brand_id !== id))
  }

  const saveFlavor = async () => {
    if (!fName.trim() || !activeBrand) return setError('Flavor name is required')
    setSaving(true); setError('')
    const { data, error } = await supabase.from('flavors').insert({ name: fName.trim(), brand_id: activeBrand }).select().single()
    setSaving(false)
    if (error) { setError(error.message); return }
    setFlavors([...flavors, data]); setFName(''); setView('flavors')
  }

  const deleteFlavor = async (id: string) => {
    if (!confirm('Delete this flavor and all its products?')) return
    await supabase.from('flavors').delete().eq('id', id)
    setFlavors(flavors.filter((f) => f.id !== id))
    setProducts(products.filter((p) => p.flavor_id !== id))
  }

  const saveProduct = async () => {
    if (!pName.trim() || !pBrandId || !pFlavorId || !pPrice) return setError('Brand, flavor, name and price are required')
    setSaving(true); setError('')
    const payload = { brand_id: pBrandId, flavor_id: pFlavorId, name: pName.trim(),
      sku_code: pSku.trim() || null, unit_price: parseFloat(pPrice),
      description: pDesc.trim() || null, status: pStatus }
    if (editingId) {
      const { error } = await supabase.from('products').update(payload).eq('id', editingId)
      if (!error) { setProducts(products.map((p) => p.id === editingId ? { ...p, ...payload } as Product : p)) }
      else setError(error.message)
    } else {
      const { data, error } = await supabase.from('products').insert(payload).select().single()
      if (!error && data) setProducts([...products, data])
      else if (error) setError(error.message)
    }
    setSaving(false)
    if (!error) { setPName(''); setPSku(''); setPPrice(''); setPDesc(''); setEditingId(null); setView('products') }
  }

  const editProduct = (p: Product) => {
    setEditingId(p.id); setPBrandId(p.brand_id); setPFlavorId(p.flavor_id)
    setPName(p.name); setPSku(p.sku_code||''); setPPrice(String(p.unit_price))
    setPDesc(p.description||''); setPStatus(p.status); setView('edit-product')
  }

  const deleteProduct = async (id: string) => {
    if (!confirm('Delete this product?')) return
    await supabase.from('products').delete().eq('id', id)
    setProducts(products.filter((p) => p.id !== id))
  }

  const brandFlavors  = flavors.filter((f) => f.brand_id === activeBrand)
  const flavorProducts = products.filter((p) => p.flavor_id === activeFlavor)
  const formFlavors   = flavors.filter((f) => f.brand_id === pBrandId)

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left panel */}
      <div className="w-56 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Brands</p>
          {brands.map((b) => (
            <div key={b.id}>
              <button onClick={() => { setActiveBrand(b.id); setActiveFlavor(null); setView('flavors') }}
                className={`w-full text-left px-2 py-1.5 rounded-lg text-sm mb-0.5 transition-colors ${activeBrand === b.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700 hover:bg-slate-50'}`}>
                {b.name}
              </button>
              {activeBrand === b.id && brandFlavors.map((f) => (
                <button key={f.id} onClick={() => { setActiveFlavor(f.id); setView('products') }}
                  className={`w-full text-left pl-6 pr-2 py-1 rounded-lg text-xs mb-0.5 transition-colors ${activeFlavor === f.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
                  {f.name}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="p-4">
          <button onClick={() => { setView('add-brand'); setError('') }}
            className="w-full py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:bg-slate-50 hover:border-slate-400 transition-colors">
            + Add Brand
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && <div className="mb-4 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

        {view === 'brands' && (
          <div>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Brands</h2>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>{['Brand','Flavors','Products',''].map((h) => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {brands.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{b.name}</td>
                      <td className="px-4 py-3 text-slate-600">{flavors.filter((f) => f.brand_id === b.id).length}</td>
                      <td className="px-4 py-3 text-slate-600">{products.filter((p) => p.brand_id === b.id).length}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => deleteBrand(b.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {!brands.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No brands yet. Add one from the left panel.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === 'add-brand' && (
          <div className="max-w-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Brand</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Brand Name</label>
                <input value={bName} onChange={(e) => setBName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Sunchips" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setView('brands')} className="flex-1 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                <button onClick={saveBrand} disabled={saving} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Brand'}</button>
              </div>
            </div>
          </div>
        )}

        {view === 'flavors' && activeBrand && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {brands.find((b) => b.id === activeBrand)?.name} — Flavors
              </h2>
              <button onClick={() => { setView('add-flavor'); setError('') }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">+ Add Flavor</button>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>{['Flavor','Products',''].map((h) => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {brandFlavors.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => { setActiveFlavor(f.id); setView('products') }}>
                      <td className="px-4 py-3 font-medium text-slate-900">{f.name}</td>
                      <td className="px-4 py-3 text-slate-600">{products.filter((p) => p.flavor_id === f.id).length}</td>
                      <td className="px-4 py-3">
                        <button onClick={(e) => { e.stopPropagation(); deleteFlavor(f.id) }} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {!brandFlavors.length && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">No flavors yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === 'add-flavor' && (
          <div className="max-w-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Flavor</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Brand</label>
                <p className="text-sm text-slate-600">{brands.find((b) => b.id === activeBrand)?.name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Flavor Name</label>
                <input value={fName} onChange={(e) => setFName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Paprika" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setView('flavors')} className="flex-1 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                <button onClick={saveFlavor} disabled={saving} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Flavor'}</button>
              </div>
            </div>
          </div>
        )}

        {(view === 'products' || view === 'add-product' || view === 'edit-product') && (
          <div>
            {view === 'products' && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {flavors.find((f) => f.id === activeFlavor)?.name} — Products
                  </h2>
                  <button onClick={() => { setEditingId(null); setPBrandId(activeBrand||''); setPFlavorId(activeFlavor||''); setPName(''); setPSku(''); setPPrice(''); setPDesc(''); setPStatus('active'); setView('add-product'); setError('') }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">+ Add Product</button>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>{['SKU','Product','Unit Price','Status',''].map((h) => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {flavorProducts.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-slate-500 text-xs">{p.sku_code || '—'}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                          <td className="px-4 py-3 text-slate-700">ETB {p.unit_price.toFixed(2)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{p.status}</span>
                          </td>
                          <td className="px-4 py-3 flex gap-2">
                            <button onClick={() => editProduct(p)} className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
                            <button onClick={() => deleteProduct(p.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                          </td>
                        </tr>
                      ))}
                      {!flavorProducts.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No products yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {(view === 'add-product' || view === 'edit-product') && (
              <div className="max-w-md">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">{editingId ? 'Edit' : 'Add'} Product</h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Brand</label>
                      <select value={pBrandId} onChange={(e) => { setPBrandId(e.target.value); setPFlavorId('') }}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Select brand</option>
                        {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Flavor</label>
                      <select value={pFlavorId} onChange={(e) => setPFlavorId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Select flavor</option>
                        {formFlavors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Product Name</label>
                    <input value={pName} onChange={(e) => setPName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Sunchips Paprika 28g" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">SKU Code</label>
                      <input value={pSku} onChange={(e) => setPSku(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Optional" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Unit Price (ETB)</label>
                      <input type="number" min={0} step="0.01" value={pPrice} onChange={(e) => setPPrice(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                    <textarea value={pDesc} onChange={(e) => setPDesc(e.target.value)} rows={2}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" placeholder="Optional" />
                  </div>
                  <div className="flex gap-4">
                    {['active','inactive'].map((s) => (
                      <label key={s} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                        <input type="radio" value={s} checked={pStatus===s} onChange={() => setPStatus(s)} className="accent-blue-600" />
                        {s.charAt(0).toUpperCase()+s.slice(1)}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setView('products')} className="flex-1 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                    <button onClick={saveProduct} disabled={saving} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Product'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
