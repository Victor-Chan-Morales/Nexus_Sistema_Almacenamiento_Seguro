export function Notice({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return <div className="billing-error-box" role="alert"><b>{title}</b><p>{message}</p>{onRetry && <p><button type="button" className="text-button" onClick={onRetry}>Reintentar</button></p>}</div>;
}
