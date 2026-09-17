import { Star } from 'lucide-react';

import { flashcardsApi } from '../services/api';
import { ReviewSession } from '../components/ReviewSession';

export function FavoritesReview() {
  return (
    <ReviewSession
      fetchQueue={flashcardsApi.favorites}
      loadErrorMessage="Não foi possível carregar seus flashcards favoritos."
      backTo="/colecoes"
      backLabel="Coleções"
      emptyIcon={Star}
      emptyTitle="Nenhum favorito ainda"
      emptyMessage="Marque flashcards com a estrela, na coleção ou durante a revisão, para montar seu baralho rápido aqui."
      completedTitle="Favoritos revisados!"
    />
  );
}
