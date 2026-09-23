/**
 * Script untuk memindahkan objek gambar produk dari format lama (tanpa tenant prefix)
 * ke format tenant-scoped `/<tenant-id>/<filename>` (Task 19.2).
 *
 * Menggunakan Supabase Storage API dengan service-role key.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/migrate-product-image-paths.mjs [--dry-run]
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Error: VITE_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di environment.')
  process.exit(1)
}

const isDryRun = process.argv.includes('--dry-run')
const supabase = createClient(supabaseUrl, serviceRoleKey)

async function main() {
  console.log(`=== Migrasi Path Storage Produk ${isDryRun ? '(DRY RUN)' : ''} ===`)

  // 1. Baca audit view product_image_path_audit
  const { data: auditRows, error: auditError } = await supabase
    .from('product_image_path_audit')
    .select('*')

  if (auditError) {
    console.error('Gagal membaca product_image_path_audit:', auditError.message)
    process.exit(1)
  }

  if (!auditRows || auditRows.length === 0) {
    console.log('Tidak ada objek non-konforman yang perlu dipindahkan.')
    return
  }

  console.log(`Ditemukan ${auditRows.length} objek non-konforman.`)

  let successCount = 0
  let skipCount = 0
  let errorCount = 0

  for (const row of auditRows) {
    const { object_name, target_name, product_id } = row

    if (object_name === target_name) {
      console.log(`[SKIP] Objek sudah konforman: ${object_name}`)
      skipCount++
      continue
    }

    console.log(`[MOVE] ${object_name} -> ${target_name} (Produk #${product_id})`)

    if (isDryRun) {
      successCount++
      continue
    }

    try {
      // Pindahkan objek di Storage
      const { error: moveError } = await supabase.storage
        .from('products')
        .move(object_name, target_name)

      if (moveError) {
        console.error(`  Gagal memindahkan storage object:`, moveError.message)
        errorCount++
        continue
      }

      // Update kolom foto_url di tabel products
      const newFotoUrl = target_name
      const { error: updateError } = await supabase
        .from('products')
        .update({ foto_url: newFotoUrl })
        .eq('id', product_id)

      if (updateError) {
        console.error(`  Gagal mengupdate products.foto_url:`, updateError.message)
        errorCount++
        continue
      }

      successCount++
      console.log(`  Berhasil.`)
    } catch (err) {
      console.error(`  Error tak terduga:`, err.message)
      errorCount++
    }
  }

  console.log(`\nSelesai: ${successCount} berhasil, ${skipCount} dilewati, ${errorCount} gagal.`)
}

main().catch(console.error)
