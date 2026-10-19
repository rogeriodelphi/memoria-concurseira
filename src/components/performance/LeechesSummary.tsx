import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Droplets } from 'lucide-react';

import { leechesApi } from '../../services/api';
import { plural } from '../../utils/performance';

/**
 * Um aviso curto, na página de desempenho, de quantos cartões o usuário erra sempre ("sanguessugas"), com o caminho
 * para a lista. Não depende do período nem dos filtros da página: olha as últimas revisões de cada cartão. Se a
 * consulta falhar, some em silêncio: é um atalho, não uma informação de que a página dependa.
 */
export function LeechesSummary() {
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    leechesApi
      .list()
      .then((data) => alive && setTotal(data.total))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (total === null) return null;

  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 p-5" aria-label="Cartões sanguessuga">
      <div className="flex min-w-0 items-start gap-3">
        <Droplets size={20} className={`mt-0.5 shrink-0 ${total > 0 ? 'text-red-500' : 'text-neutral-400'}`} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Cartões sanguessuga</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {total > 0
              ? `${plural(total, 'cartão que você erra sempre', 'cartões que você erra sempre')}: gastam revisão sem fixar. Dá para reescrever, quebrar, adiar ou criar um macete.`
              : 'Nenhum cartão que você erra sempre, por enquanto.'}
          </p>
        </div>
      </div>
      <Link to="/sanguessugas" className={total > 0 ? 'btn-primary !py-1.5 text-xs' : 'btn-secondary !py-1.5 text-xs'}>
        {total > 0 ? 'Ver os cartões' : 'Ver a regra'}
      </Link>
    </section>
  );
}
