// Executado uma vez quando o servidor Next.js inicia.
// Retoma a análise dos documentos das licitações que ficou na fila (no banco) quando o processo anterior
// encerrou: sem isto, os pedidos pendentes só voltariam a andar no próximo pedido de um usuário.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { resumeTenderAnalysisWorkers } = await import('@/lib/tenders/analysis');
    resumeTenderAnalysisWorkers();
  } catch (error) {
    // O servidor deve subir mesmo que a fila não possa ser retomada (ex.: banco ainda indisponível).
    console.error('[requisitos] não foi possível retomar a fila de análise', error);
  }
}
