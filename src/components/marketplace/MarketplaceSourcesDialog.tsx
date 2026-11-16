'use client';

import { useState } from 'react';
import { useMarketplaceSourceMutation } from '@/client/query/marketplace';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { MarketplaceProtocol, MarketplaceSourceConfig } from '@/types/marketplace';

const PROTOCOL_LABELS: Record<MarketplaceProtocol, string> = {
  catalog: 'JSON 技能目录',
  matrix: 'Matrix 兼容 API',
  skillhub: 'SkillHub 兼容 API',
};

const PROTOCOL_HINTS: Record<MarketplaceProtocol, string> = {
  catalog: '填写 catalog.json 的完整地址。ZIP 可以用目录同源的相对路径。',
  matrix: '填写技能 API 基址，例如 https://example.com/api/registry/skill。',
  skillhub: '填写 API 基址，例如 https://example.com，由市场提供 /api/skills 等接口。',
};

interface MarketplaceSourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: MarketplaceSourceConfig[];
  onSourceAdded: (id: string) => void;
  onSourceRemoved: (id: string) => void;
}

export function MarketplaceSourcesDialog({ open, onOpenChange, sources, onSourceAdded, onSourceRemoved }: MarketplaceSourcesDialogProps) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [protocol, setProtocol] = useState<MarketplaceProtocol>('catalog');
  const [error, setError] = useState('');
  const mutation = useMarketplaceSourceMutation();

  async function save() {
    setError('');
    try {
      const result = await mutation.mutateAsync({ label, url, protocol });
      if (result.source) {
        onSourceAdded(result.source.id);
        setLabel('');
        setUrl('');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '添加失败');
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await mutation.mutateAsync({ id });
      onSourceRemoved(id);
    } catch (error) {
      setError(error instanceof Error ? error.message : '移除失败');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>市场来源</DialogTitle>
          <DialogDescription>添加来源后，可以在技能市场中一起搜索和安装。移除来源会保留已安装的技能。</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {sources.map((source) => (
            <li key={source.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{source.label}</p>
                <p className="truncate text-xs text-muted-foreground" title={source.url}>{source.url}</p>
              </div>
              {source.builtin ? (
                <span className="shrink-0 text-xs text-muted-foreground">内置</span>
              ) : (
                <Button type="button" variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => void remove(source.id)}>
                  移除
                </Button>
              )}
            </li>
          ))}
        </ul>

        <form className="space-y-3 border-t pt-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>市场名称</span>
              <Input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} required />
            </label>
            <div className="space-y-1 text-sm">
              <label htmlFor="marketplace-protocol">协议</label>
              <Select value={protocol} onValueChange={(value) => setProtocol(value as MarketplaceProtocol)}>
                <SelectTrigger id="marketplace-protocol"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROTOCOL_LABELS).map(([value, name]) => <SelectItem key={value} value={value}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="block space-y-1 text-sm">
            <span>市场地址</span>
            <Input type="url" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} required />
          </label>
          <p className="text-xs text-muted-foreground">{PROTOCOL_HINTS[protocol]}</p>
          {protocol === 'catalog' ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">查看目录示例</summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2">
                {JSON.stringify({ skills: [{ slug: 'example', name: '示例技能', description: '技能描述', version: '1.0.0', downloadUrl: 'example.zip' }] }, null, 2)}
              </pre>
            </details>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={mutation.isPending || !label.trim() || !url.trim()}>
              {mutation.isPending ? '处理中…' : '验证并添加'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
