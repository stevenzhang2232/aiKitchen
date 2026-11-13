import { Modal } from '../components/Modal';

/** Placeholder until phase 5 wires up receipt recognition. */
export function ReceiptScanner({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Scan a receipt" onClose={onClose}>
      <p className="muted">Receipt scanning needs an AI model. Set one up in Settings → AI model.</p>
    </Modal>
  );
}
