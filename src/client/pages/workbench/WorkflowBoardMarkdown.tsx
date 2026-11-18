import { useEffect, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { workspaceApi } from '@/lib/core/api';
import { WORKFLOW_BOARD_DIRECTORY } from '@/lib/workspace/workflow-boards';

function WorkspaceBoardImage({ source, alt, workspace }: { source: string; alt: string; workspace: string }) {
  const [image, setImage] = useState<{ source: string; workspace: string; url?: string }>();
  useEffect(() => {
    const pathname = source.replace(/^\.\//, '');
    if (!workspace || !/^[a-z\d][a-z\d._-]*\.(png|jpe?g|webp|gif|avif)$/i.test(pathname)) {
      return;
    }
    let current = true;
    let url: string | undefined;
    void workspaceApi.getFileBlob(workspace, WORKFLOW_BOARD_DIRECTORY + '/' + pathname).then((blob) => {
      if (!current) return;
      url = URL.createObjectURL(blob);
      setImage({ source, workspace, url });
    }, () => {
      if (current) setImage({ source, workspace });
    });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, workspace]);

  const url = image?.source === source && image.workspace === workspace ? image.url : undefined;
  return url
    ? <img src={url} alt={alt} className="block h-full max-h-full w-full max-w-full object-contain" />
    : <span className="text-sm text-muted-foreground">{alt}</span>;
}

export function WorkflowBoardMarkdown({ content, workspace }: { content: string; workspace: string }) {
  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden">
      <ReactMarkdown
        urlTransform={(url, key) => key === 'src' ? defaultUrlTransform(url) : ''}
        components={{
          p: ({ children }) => <p className="m-0 h-full min-h-0">{children}</p>,
          img: ({ src, alt }) => <WorkspaceBoardImage source={src ?? ''} alt={alt ?? ''} workspace={workspace} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
