'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SkillSearchProps {
  onSearch: (keyword: string) => void;
  onCategoryChange: (category: string) => void;
  categories: Array<{ id: string; enName: string; cnName: string; count: number }>;
}

export function SkillSearch({ onSearch, onCategoryChange, categories }: SkillSearchProps) {
  const [keyword, setKeyword] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const handleSearch = () => {
    onSearch(keyword);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleCategoryClick = (categoryId: string) => {
    setSelectedCategory(categoryId);
    onCategoryChange(categoryId);
  };

  return (
    <div className="mb-6 space-y-4">
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder="搜索 skill..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyPress={handleKeyPress}
          className="flex-1"
        />
        <Button onClick={handleSearch}>
          🔍 搜索
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => handleCategoryClick('')}
          variant={selectedCategory === '' ? 'default' : 'outline'}
          size="sm"
        >
          全部
        </Button>

        {categories.slice(0, 10).map(category => (
          <Button
            key={category.id}
            onClick={() => handleCategoryClick(category.id)}
            variant={selectedCategory === category.id ? 'default' : 'outline'}
            size="sm"
          >
            {category.cnName} ({category.count})
          </Button>
        ))}
      </div>
    </div>
  );
}