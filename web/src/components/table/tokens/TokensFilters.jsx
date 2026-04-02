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

import React, { useRef, useState, useEffect } from 'react';
import { Form, Button, Select } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { API } from '../../../helpers';

const statusOptions = (t) => [
  { label: t('全部状态'), value: 0 },
  { label: t('已启用'), value: 1 },
  { label: t('已禁用'), value: 2 },
  { label: t('已过期'), value: 3 },
  { label: t('已耗尽'), value: 4 },
];

const TokensFilters = ({
  formInitValues,
  setFormApi,
  searchTokens,
  loading,
  isAdmin,
  t,
}) => {
  // Handle form reset and immediate search
  const formApiRef = useRef(null);

  // Load user groups for filter (user mode only)
  const [groupOptions, setGroupOptions] = useState([]);
  useEffect(() => {
    if (isAdmin) return;
    const loadGroups = async () => {
      try {
        const res = await API.get('/api/user/self/groups');
        const { success, data } = res.data;
        if (success) {
          const options = Object.entries(data).map(([group, info]) => ({
            label: info.desc || group,
            value: group,
          }));
          setGroupOptions(options);
        }
      } catch (e) {
        // silently ignore
      }
    };
    loadGroups();
  }, [isAdmin]);

  const handleReset = () => {
    if (!formApiRef.current) return;
    formApiRef.current.reset();
    setTimeout(() => {
      searchTokens();
    }, 100);
  };

  return (
    <Form
      initValues={formInitValues}
      getFormApi={(api) => {
        setFormApi(api);
        formApiRef.current = api;
      }}
      onSubmit={() => searchTokens(1)}
      allowEmpty={true}
      autoComplete='off'
      layout='horizontal'
      trigger='change'
      stopValidateWithError={false}
      className='w-full md:w-auto order-1 md:order-2'
    >
      <div className='flex flex-col md:flex-row items-center gap-2 w-full md:w-auto'>
        {isAdmin && (
          <div className='relative w-full md:w-40'>
            <Form.Input
              field='username'
              prefix={<IconSearch />}
              placeholder={t('用户名')}
              showClear
              pure
              size='small'
            />
          </div>
        )}
        <div className='relative w-full md:w-40'>
          <Form.Input
            field='token_name'
            prefix={<IconSearch />}
            placeholder={t('令牌名称')}
            showClear
            pure
            size='small'
          />
        </div>
        <div className='relative w-full md:w-44'>
          <Form.Input
            field='searchToken'
            prefix={<IconSearch />}
            placeholder={t('密钥')}
            showClear
            pure
            size='small'
          />
        </div>
        <div className='relative w-full md:w-32'>
          <Form.Select
            field='status'
            placeholder={t('状态')}
            optionList={statusOptions(t)}
            pure
            size='small'
            className='w-full'
          />
        </div>
        {!isAdmin && groupOptions.length > 0 && (
          <div className='relative w-full md:w-36'>
            <Form.Select
              field='group'
              placeholder={t('全部分组')}
              optionList={[
                { label: t('全部分组'), value: '' },
                ...groupOptions,
              ]}
              pure
              size='small'
              className='w-full'
              showClear
            />
          </div>
        )}

        <div className='flex gap-2 w-full md:w-auto'>
          <Button
            type='tertiary'
            htmlType='submit'
            loading={loading}
            className='flex-1 md:flex-initial md:w-auto'
            size='small'
          >
            {t('查询')}
          </Button>

          <Button
            type='tertiary'
            onClick={handleReset}
            className='flex-1 md:flex-initial md:w-auto'
            size='small'
          >
            {t('重置')}
          </Button>
        </div>
      </div>
    </Form>
  );
};

export default TokensFilters;
