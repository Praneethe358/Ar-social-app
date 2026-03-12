import { useState } from 'react';

const EMOJIS = ['🔥', '😂', '🍕', '🎉'];

function CreatePost({ isOpen, onSubmit, onCancel }) {
  const [type, setType] = useState('emoji');
  const [content, setContent] = useState(EMOJIS[0]);

  if (!isOpen) return null;

  function handleTypeChange(nextType) {
    setType(nextType);
    setContent(nextType === 'emoji' ? EMOJIS[0] : '');
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!content.trim()) return;

    onSubmit({
      type,
      content: content.trim(),
    });
  }

  return (
    <div className="composer-backdrop">
      <form className="composer-card" onSubmit={handleSubmit}>
        <h3>Create AR Post</h3>

        <div className="composer-toggle" role="tablist" aria-label="Post type">
          <button
            type="button"
            className={type === 'emoji' ? 'toggle-btn toggle-btn--active' : 'toggle-btn'}
            onClick={() => handleTypeChange('emoji')}
          >
            Emoji
          </button>
          <button
            type="button"
            className={type === 'text' ? 'toggle-btn toggle-btn--active' : 'toggle-btn'}
            onClick={() => handleTypeChange('text')}
          >
            Text
          </button>
        </div>

        {type === 'emoji' ? (
          <div className="emoji-grid" aria-label="Choose emoji">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={content === emoji ? 'emoji-btn emoji-btn--active' : 'emoji-btn'}
                onClick={() => setContent(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : (
          <input
            type="text"
            maxLength={50}
            placeholder="Write short AR text"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        )}

        <div className="composer-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-btn">
            Place & Save
          </button>
        </div>
      </form>
    </div>
  );
}

export default CreatePost;
