/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useState } from 'react';
import { Button, Space } from '@douyinfe/semi-ui';
import { showError } from '../../../helpers';
import CopyTokensModal from './modals/CopyTokensModal';
import DeleteTokensModal from './modals/DeleteTokensModal';
import BatchUpdateTokensModal from './modals/BatchUpdateTokensModal';

const TokensActions = ({
  selectedKeys,
  setEditingToken,
  setShowEdit,
  batchCopyTokens,
  batchDeleteTokens,
  batchUpdateTokens,
  copyText,
  allowCreate = true,
  enableQuotaLimit = false,
  t,
}) => {
  // Modal states
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showBatchUpdateModal, setShowBatchUpdateModal] = useState(false);
  const [batchUpdateLoading, setBatchUpdateLoading] = useState(false);

  // Handle copy selected tokens with options
  const handleCopySelectedTokens = () => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个令牌！'));
      return;
    }
    setShowCopyModal(true);
  };

  // Handle delete selected tokens with confirmation
  const handleDeleteSelectedTokens = () => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个令牌！'));
      return;
    }
    setShowDeleteModal(true);
  };

  // Handle batch update selected tokens
  const handleBatchUpdateTokens = () => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个令牌！'));
      return;
    }
    setShowBatchUpdateModal(true);
  };

  // Handle batch update confirmation
  const handleConfirmBatchUpdate = async (action, values) => {
    setBatchUpdateLoading(true);
    try {
      const success = await batchUpdateTokens(action, values);
      if (success) {
        setShowBatchUpdateModal(false);
      }
    } finally {
      setBatchUpdateLoading(false);
    }
  };

  // Handle delete confirmation
  const handleConfirmDelete = () => {
    batchDeleteTokens();
    setShowDeleteModal(false);
  };

  return (
    <>
      <div className='flex flex-wrap gap-2 w-full md:w-auto order-2 md:order-1'>
        {allowCreate && (
          <Button
            type='primary'
            className='flex-1 md:flex-initial'
            onClick={() => {
              setEditingToken({
                id: undefined,
              });
              setShowEdit(true);
            }}
            size='small'
          >
            {t('添加令牌')}
          </Button>
        )}

        <Button
          type='tertiary'
          className='flex-1 md:flex-initial'
          onClick={handleCopySelectedTokens}
          size='small'
        >
          {t('复制所选令牌')}
        </Button>

        {batchUpdateTokens && (
          <Button
            type='secondary'
            className='flex-1 md:flex-initial'
            onClick={handleBatchUpdateTokens}
            size='small'
          >
            {t('批量修改')}
          </Button>
        )}

        <Button
          type='danger'
          className='w-full md:w-auto'
          onClick={handleDeleteSelectedTokens}
          size='small'
        >
          {t('删除所选令牌')}
        </Button>
      </div>

      <CopyTokensModal
        visible={showCopyModal}
        onCancel={() => setShowCopyModal(false)}
        selectedKeys={selectedKeys}
        copyText={copyText}
        t={t}
      />

      <DeleteTokensModal
        visible={showDeleteModal}
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        selectedKeys={selectedKeys}
        t={t}
      />

      {batchUpdateTokens && (
        <BatchUpdateTokensModal
          visible={showBatchUpdateModal}
          onCancel={() => setShowBatchUpdateModal(false)}
          onConfirm={handleConfirmBatchUpdate}
          selectedCount={selectedKeys.length}
          loading={batchUpdateLoading}
          enableQuotaLimit={enableQuotaLimit}
          t={t}
        />
      )}
    </>
  );
};

export default TokensActions;
