import { redirect } from 'next/navigation'

// Server-side 307 redirect — sem flash visual e sem hydration.
// Mantemos /register como rota publica (links externos, anuncios)
// que aterrissam direto na tab de cadastro do /login.
//
// IMPORTANTE: repassa TODOS os query params recebidos (sck/fbp/fbc/utm_*/
// fbclid) para o /login — sem isso, um link tipo /register?sck=X&fbp=Y
// perderia esses params no redirect e o tracking (captureMetaTracking)
// nunca os veria.
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = new URLSearchParams()
  params.set('tab', 'register')
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === 'tab') continue
    if (typeof value === 'string') params.set(key, value)
    else if (Array.isArray(value) && value[0] !== undefined) params.set(key, value[0])
  }
  redirect(`/login?${params.toString()}`)
}
