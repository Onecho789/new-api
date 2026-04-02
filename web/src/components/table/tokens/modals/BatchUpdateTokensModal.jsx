import React, { useRef, useState } from 'react';
import {
  Modal,
  Form,
  Col,
  Row,
  Typography,
  Banner,
} from '@douyinfe/semi-ui';
import { renderQuotaWithPrompt } from '../../../../helpers';

const { Text } = Typography;

const BatchUpdateTokensModal = ({
  visible,
  onCancel,
  onConfirm,
  selectedCount,
  loading,
  enableQuotaLimit = false,
  t,
}) => {
  const formApiRef = useRef(null);
  const [action, setAction] = useState('set_quota');

  const handleOk = () => {
    if (!formApiRef.current) return;
    formApiRef.current.validate().then((values) => {
      console.log('[BatchUpdateModal] action:', action, 'validated values:', JSON.stringify(values));
      onConfirm(action, values);
    }).catch((err) => {
      console.log('[BatchUpdateModal] validation failed:', err);
      // validation failed, form will show error messages
    });
  };

  const handleAfterClose = () => {
    setAction('set_quota');
    formApiRef.current?.reset();
  };

  return (
    <Modal
      title={t('批量修改')}
      visible={visible}
      onOk={handleOk}
      onCancel={onCancel}
      afterClose={handleAfterClose}
      okText={t('确认修改')}
      cancelText={t('取消')}
      confirmLoading={loading}
      maskClosable={false}
    >
      {/* Action type selector */}
      <Form
        initValues={{
          remain_quota: 0,
          unlimited_quota: false,
          quota_limit_period: 'never',
          quota_limit: 0,
          quota_limit_custom_seconds: 0,
        }}
        getFormApi={(api) => (formApiRef.current = api)}
      >
        {({ values }) => (
          <div>
            <Row gutter={12}>
              <Col span={24}>
                <Form.Select
                  field='_action'
                  label={t('操作类型')}
                  placeholder={t('选择操作类型')}
                  style={{ width: '100%' }}
                  initValue='set_quota'
                  onChange={(val) => setAction(val)}
                  optionList={[
                    { value: 'set_quota', label: t('设置额度') },
                    ...(enableQuotaLimit
                      ? [{ value: 'set_periodic_quota', label: t('设置周期限额') }]
                      : []),
                  ]}
                />
              </Col>

              {action === 'set_quota' && (
                <>
                  <Col span={24}>
                    <Form.AutoComplete
                      field='remain_quota'
                      label={t('额度')}
                      placeholder={t('请输入额度')}
                      type='number'
                      disabled={values.unlimited_quota}
                      extraText={renderQuotaWithPrompt(values.remain_quota)}
                      rules={
                        values.unlimited_quota
                          ? []
                          : [{ required: true, message: t('请输入额度') }]
                      }
                      data={[
                        { value: 500000, label: '1$' },
                        { value: 5000000, label: '10$' },
                        { value: 25000000, label: '50$' },
                        { value: 50000000, label: '100$' },
                        { value: 250000000, label: '500$' },
                        { value: 500000000, label: '1000$' },
                      ]}
                    />
                  </Col>
                  <Col span={24}>
                    <Form.Switch
                      field='unlimited_quota'
                      label={t('无限额度')}
                      size='default'
                    />
                  </Col>
                </>
              )}

              {action === 'set_periodic_quota' && (
                <>
                  <Col span={24}>
                    <Form.Select
                      field='quota_limit_period'
                      label={t('周期限额')}
                      placeholder={t('选择限额周期')}
                      style={{ width: '100%' }}
                      optionList={[
                        { value: 'never', label: t('不限制') },
                        { value: 'daily', label: t('每日') },
                        { value: 'weekly', label: t('每周') },
                        { value: 'monthly', label: t('每月') },
                        { value: 'custom', label: t('自定义') },
                      ]}
                    />
                  </Col>
                  {values.quota_limit_period && values.quota_limit_period !== 'never' && (
                    <Col span={24}>
                      <Form.AutoComplete
                        field='quota_limit'
                        label={t('周期限额额度')}
                        placeholder={t('请输入周期限额')}
                        type='number'
                        rules={[
                          {
                            validator: (rule, value) => {
                              const num = parseInt(value);
                              if (isNaN(num) || num <= 0) {
                                return Promise.reject(t('请输入周期限额'));
                              }
                              return Promise.resolve();
                            },
                          },
                        ]}
                        data={[
                          { value: 500000, label: '1$' },
                          { value: 5000000, label: '10$' },
                          { value: 25000000, label: '50$' },
                          { value: 50000000, label: '100$' },
                          { value: 250000000, label: '500$' },
                        ]}
                        extraText={renderQuotaWithPrompt(values.quota_limit)}
                      />
                    </Col>
                  )}
                  {values.quota_limit_period === 'custom' && (
                    <Col span={24}>
                      <Form.InputNumber
                        field='quota_limit_custom_seconds'
                        label={t('自定义周期（秒）')}
                        placeholder={t('请输入自定义周期秒数')}
                        min={60}
                        rules={[{ required: true, message: t('请输入自定义周期秒数') }]}
                        style={{ width: '100%' }}
                      />
                    </Col>
                  )}
                </>
              )}
            </Row>

            <Banner
              type='info'
              description={t('将修改 {{count}} 个令牌', { count: selectedCount })}
              className='mt-3'
            />
          </div>
        )}
      </Form>
    </Modal>
  );
};

export default BatchUpdateTokensModal;
