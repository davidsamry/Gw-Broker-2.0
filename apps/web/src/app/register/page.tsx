import { redirect } from 'next/navigation'

// Server-side 307 redirect — sem flash visual e sem hydration.
// Mantemos /register como rota publica (links externos, anuncios)
// que aterrissam direto na tab de cadastro do /login.
export default function RegisterPage() {
  redirect('/login?tab=register')
}
