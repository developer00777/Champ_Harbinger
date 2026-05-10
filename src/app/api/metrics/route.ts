import { NextResponse } from 'next/server';
import { getRegistryForExport } from '@/lib/monitoring/metrics';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const registry = getRegistryForExport();
  const body = await registry.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': registry.contentType,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
