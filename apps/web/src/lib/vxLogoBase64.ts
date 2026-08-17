// Logo VX Global embutida em base64 para uso no PDF de extrato.
//
// Por que embutida e nao carregada de /vx-logo.png: o jsPDF precisa dos
// BYTES da imagem no momento da geracao. Buscar por rede adicionaria uma
// requisicao que pode falhar (offline, CORS, cache), e o PDF sairia sem a
// marca. Embutida, o documento e sempre self-contained.
//
// Origem: public/vx-logo.png (1130x247, 187kB) redimensionada para 320px de
// largura e comprimida -> 7,4kB. No PDF ocupa ~34mm, o que da ~240 DPI:
// nitida em tela e na impressao.
//
// Para atualizar apos trocar a logo oficial:
//   node -e "require('sharp')('public/vx-logo.png').resize({width:320}).png({compressionLevel:9,palette:true}).toBuffer().then(b=>console.log(b.toString('base64')))"
// e substitua a string abaixo.

/** Proporcao largura/altura da imagem — usada para nao distorcer no PDF. */
export const VX_LOGO_ASPECT = 4.5749

export const VX_LOGO_PNG_BASE64 =
  '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'
