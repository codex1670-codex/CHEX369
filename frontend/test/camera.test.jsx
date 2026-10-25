import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Replace the real camera (needs a device) with a stub that "captures" a photo on demand.
let supported = true;
vi.mock('../src/components/CameraCapture.jsx', () => ({
  cameraSupported: () => supported,
  default: ({ onCapture, onClose, modes }) => (
    <div role="dialog" aria-label="Camera" data-modes={modes.join(',')}>
      <button onClick={() => onCapture(new File(['x'], 'photo-1.jpg', { type: 'image/jpeg' }))}>shutter</button>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));
vi.mock('../src/components/EditedMedia.jsx', () => ({ default: () => <div data-testid="preview" /> }));

const { default: MediaPicker } = await import('../src/components/MediaPicker.jsx');

beforeEach(() => { cleanup(); supported = true; URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn(); });

describe('MediaPicker live camera', () => {
  it('opens the live camera, and a captured photo becomes the picked media', () => {
    const onChange = vi.fn();
    render(<MediaPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText(/Camera/));
    expect(screen.getByRole('dialog', { name: 'Camera' }).dataset.modes).toBe('photo,video');
    fireEvent.click(screen.getByText('shutter'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image', file: expect.any(File) }));
  });

  it('video-only pickers (reels) get a video-only camera', () => {
    render(<MediaPicker value={null} onChange={vi.fn()} allow={['video']} />);
    fireEvent.click(screen.getByText(/Camera/));
    expect(screen.getByRole('dialog', { name: 'Camera' }).dataset.modes).toBe('video');
  });

  it('closing the camera attaches nothing', () => {
    const onChange = vi.fn();
    render(<MediaPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText(/Camera/));
    fireEvent.click(screen.getByText('close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('without camera support it falls back to the phone camera input', () => {
    supported = false;
    const clicked = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    render(<MediaPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText(/Camera/));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(clicked).toHaveBeenCalled();
    clicked.mockRestore();
  });
});
