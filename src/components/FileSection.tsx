import { useRef } from 'react';
import { UploadSectionDefinition, UploadSectionState } from '../types';
import { formatDateTime, formatFileSize } from '../utils/format';

interface FileSectionProps {
  definition: UploadSectionDefinition;
  section: UploadSectionState;
  isPersistent?: boolean;
  onAddFiles: (sectionId: UploadSectionState['id'], files: FileList | null, mode: 'append' | 'replace') => void;
  onRemoveFile: (sectionId: UploadSectionState['id'], fileId: string) => void;
  onClearSection: (sectionId: UploadSectionState['id']) => void;
  onToggleFiles: (sectionId: UploadSectionState['id']) => void;
  onConfirmSection: (sectionId: UploadSectionState['id']) => void;
}

export function FileSection(props: FileSectionProps) {
  const { definition, section, isPersistent = false, onAddFiles, onRemoveFile, onClearSection, onToggleFiles, onConfirmSection } = props;
  const appendInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const accept = definition.acceptedExtensions.map((extension) => `.${extension}`).join(',');

  return (
    <section className={`section-card${isPersistent ? ' section-card--persistent' : ''}`}>
      <div className="section-card__header">
        <div>
          <h2>
            {definition.title}
            {isPersistent && <span className="persistent-badge">Salvo neste navegador</span>}
          </h2>
          <p>{definition.description}</p>
          {isPersistent && (
            <p className="persistent-note">
              Os arquivos desta seção ficam salvos automaticamente e são recarregados a cada nova sessão. Não é necessário reanexá-los para cada análise.
            </p>
          )}
        </div>
        <div className={`status-chip ${section.confirmed ? 'status-chip--success' : 'status-chip--neutral'}`}>
          {section.confirmed ? 'Seção confirmada' : 'Aguardando confirmação'}
        </div>
      </div>

      <div className="section-card__actions">
        <button type="button" className="button button--primary" onClick={() => appendInputRef.current?.click()}>
          Anexar arquivos
        </button>
        <button type="button" className="button" onClick={() => appendInputRef.current?.click()}>
          Adicionar mais arquivos
        </button>
        <button
          type="button"
          className="button"
          onClick={() => replaceInputRef.current?.click()}
          disabled={!section.files.length}
        >
          Substituir arquivos
        </button>
        <button
          type="button"
          className={`button${isPersistent ? ' button--danger' : ''}`}
          onClick={() => onClearSection(section.id)}
          disabled={!section.files.length}
        >
          {isPersistent ? 'Excluir dados salvos' : 'Limpar seção'}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onToggleFiles(section.id)}
          disabled={!section.files.length}
        >
          Visualizar arquivos anexados
        </button>
        <button
          type="button"
          className="button button--success"
          onClick={() => onConfirmSection(section.id)}
          disabled={!section.files.length}
        >
          Confirmar seção
        </button>
      </div>

      <input
        ref={appendInputRef}
        className="hidden-input"
        type="file"
        accept={accept}
        multiple
        onChange={(event) => {
          onAddFiles(section.id, event.target.files, 'append');
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={replaceInputRef}
        className="hidden-input"
        type="file"
        accept={accept}
        multiple
        onChange={(event) => {
          onAddFiles(section.id, event.target.files, 'replace');
          event.currentTarget.value = '';
        }}
      />

      <div className="section-card__footer">
        <span>{section.files.length} arquivo(s) anexado(s)</span>
        <span>Formatos aceitos: {definition.acceptedExtensions.join(', ').toUpperCase()}</span>
      </div>

      {section.showFiles && (
        <div className="file-list">
          {section.files.map((file) => (
            <article key={file.id} className="file-item">
              <div className="file-item__meta">
                <strong>{file.name}</strong>
                <span>
                  {file.extension.toUpperCase()} · {formatFileSize(file.size)} · importado em {formatDateTime(file.importedAt)}
                </span>
                <span className={`file-badge ${file.status === 'ready' ? 'file-badge--ok' : 'file-badge--error'}`}>
                  {file.status === 'ready' ? 'Pronto para análise' : file.issue || 'Inválido'}
                </span>
                {isPersistent && (
                  <span className="file-badge file-badge--saved">Salvo permanentemente</span>
                )}
              </div>
              <button type="button" className="button button--danger" onClick={() => onRemoveFile(section.id, file.id)}>
                Excluir arquivo
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
