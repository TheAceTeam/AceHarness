'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, PackagePlus } from 'lucide-react';
import { useSaveWorkflowTemplateMutation } from '@/client/query/workflow-templates';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';

export interface SaveWorkflowTemplateDialogProps {
  open: boolean;
  workflow: { filename: string; name: string; description?: string } | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function defaultTemplateId(filename: string) {
  return filename
    .replace(/\.ya?ml$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workflow-template';
}

export default function SaveWorkflowTemplateDialog({
  open,
  workflow,
  onOpenChange,
  onSaved,
}: SaveWorkflowTemplateDialogProps) {
  const { toast } = useToast();
  const saveMutation = useSaveWorkflowTemplateMutation();
  const [id, setId] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('自定义');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !workflow) return;
    setId(defaultTemplateId(workflow.filename));
    setVersion('1.0.0');
    setName(workflow.name || defaultTemplateId(workflow.filename));
    setDescription(workflow.description || '');
    setCategory('自定义');
    setTags('');
    setVisibility('private');
    setError('');
  }, [open, workflow]);

  const handleSubmit = async () => {
    if (!workflow) return;
    setError('');
    try {
      const result = await saveMutation.mutateAsync({
        sourceFilename: workflow.filename,
        id: id.trim(),
        version: version.trim(),
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        tags: tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
        visibility,
      });
      toast('success', `模板 ${result.template.name} v${result.template.version} 已保存`);
      onOpenChange(false);
      onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存模板失败');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saveMutation.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>另存为模板</DialogTitle>
          <DialogDescription>{workflow?.name} · {workflow?.filename}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="template-id">模板 ID</Label>
            <Input id="template-id" value={id} onChange={(event) => setId(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-version">版本</Label>
            <Input id="template-version" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="template-name">模板名称</Label>
            <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="template-description">描述</Label>
            <Textarea id="template-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-category">分类</Label>
            <Input id="template-category" value={category} onChange={(event) => setCategory(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-visibility">可见性</Label>
            <Select value={visibility} onValueChange={(value: 'private' | 'public') => setVisibility(value)}>
              <SelectTrigger id="template-visibility"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="private">个人</SelectItem>
                <SelectItem value="public">团队公开</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="template-tags">标签</Label>
            <Input id="template-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="研发, 评审" />
          </div>
          {error ? (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>取消</Button>
          <Button onClick={() => void handleSubmit()} disabled={saveMutation.isPending || !id.trim() || !version.trim() || !name.trim()}>
            {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-2 h-4 w-4" />}
            保存模板
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
